#!/usr/bin/env tsx
// oxlint-disable no-console
// oxlint-disable no-control-regex
/**
 * A pure TS/NodeJS harness for iterative agentic coding
 *
 * Runs an AI agent in a self-correcting loop until task completion.
 *
 * Usage:
 *   npx tsx tools/wigg.ts "Your task description" [options]
 *   pnpm tsx wigg "Your task description" [options]
 */

import { spawn, execSync } from 'node:child_process';
import {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    unlinkSync,
    createWriteStream,
    type WriteStream
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = (() => {
    try {
        const pkgPath = join(__dirname, 'package.json');
        if (existsSync(pkgPath)) {
            return (
                JSON.parse(readFileSync(pkgPath, 'utf-8')).version || 'unknown'
            );
        }
    } catch {}
    return 'unknown';
})();

/**
 * Resolve a preferred Windows shell for child_process.spawn.
 *
 * Node's default when `shell: true` on Windows is `%ComSpec%` — almost always
 * cmd.exe, which has a stack of papercuts (argv newline truncation with
 * /d /s /c "...", no stop-parsing token, limited command-line length, weak
 * error propagation). Prefer pwsh (PowerShell 7+) where installed, fall back
 * to Windows PowerShell 5.1, fall back to Node's default (cmd.exe) as a last
 * resort. The env override WIGG_SHELL=<path> forces a specific shell.
 *
 * Returns either an absolute path to the chosen shell (string), or `true`
 * meaning "use Node's default" — both shapes are valid inputs to spawn's
 * `shell` option.
 */
function resolveWindowsShell(): string | true {
    if (process.platform !== 'win32') {
        return true;
    }
    const override = process.env.WIGG_SHELL?.trim();
    if (override) {
        return override;
    }
    for (const candidate of ['pwsh.exe', 'powershell.exe']) {
        try {
            const out = execSync(`where.exe ${candidate}`, {
                stdio: ['ignore', 'pipe', 'ignore'],
                windowsHide: true
            })
                .toString()
                .trim();
            const firstPath = out.split(/\r?\n/)[0]?.trim();
            if (firstPath && existsSync(firstPath)) {
                return firstPath;
            }
        } catch {
            // shell not found on PATH, try next candidate
        }
    }
    return true;
}

const WIN_SHELL = resolveWindowsShell();

// ============================================================================
// Configuration
// ============================================================================

interface AgentConfig {
    name: string;
    command: string;
    usesPromptFile?: boolean; // If true, write prompt to file and pass via -f
    usesStdin?: boolean; // If true, pipe prompt via child stdin (not as argv)
    /**
     * If true, the agent emits newline-delimited JSON events on stdout (Claude
     * Code's `--output-format stream-json`). We pretty-print those live so the
     * operator can see tool calls / assistant text while the iteration runs,
     * instead of the default `-p` behavior which buffers everything until the
     * very end when stdin isn't a TTY.
     */
    streamsJson?: boolean;
    buildArgs: (prompt: string, options: AgentOptions) => string[];
}

interface AgentOptions {
    model?: string;
    allowAll?: boolean;
}

const AGENTS: Record<string, AgentConfig> = {
    opencode: {
        name: 'OpenCode',
        command: 'opencode',
        usesPromptFile: true,
        buildArgs: (prompt, options) => {
            // prompt here is actually the path to the prompt file
            // OpenCode syntax: opencode run [message..] -f <file>
            const args = [
                'run',
                'Execute the task described in the attached prompt file',
                '-f',
                prompt
            ];
            if (options.model) {
                args.push('-m', options.model);
            }
            return args;
        }
    },
    'claude-code': {
        name: 'Claude Code',
        command: 'claude',
        // Pipe the prompt through stdin instead of argv. Defense in depth: we
        // prefer pwsh over cmd.exe on Windows (see resolveWindowsShell), but
        // even pwsh -c has argv-quoting quirks with multi-line strings, and
        // cmd.exe /d /s /c "..." TRUNCATES arguments at the first newline if
        // pwsh is ever unavailable. Stdin-piping sidesteps both.
        usesStdin: true,
        // Request NDJSON event stream so we can render progress live. Without
        // this, `claude -p` with a non-TTY stdin buffers all output until the
        // run completes, which looks like the loop is hanging silently.
        streamsJson: true,
        buildArgs: (_prompt, options) => {
            const args = ['-p', '--verbose', '--output-format', 'stream-json'];
            if (options.model) {
                args.push('--model', options.model);
            }
            if (options.allowAll) {
                args.push('--dangerously-skip-permissions');
            }
            return args;
        }
    },
    codex: {
        name: 'OpenAI Codex',
        command: 'codex',
        buildArgs: (prompt, options) => {
            const args = ['exec'];
            if (options.model) {
                args.push('--model', options.model);
            }
            if (options.allowAll) {
                args.push('--full-auto');
            }
            args.push(prompt);
            return args;
        }
    }
};

// ============================================================================
// State & History Types
// ============================================================================

interface VerifyCommand {
    label: string;
    command: string;
}

interface VerificationResult {
    label: string;
    command: string;
    exitCode: number;
    durationMs: number;
    outputTail: string;
}

interface IterationArtifact {
    baseSha: string | null;
    headSha: string | null;
    filesChanged: string[];
    linesAdded: number;
    linesRemoved: number;
    diffStat: string;
    verifications: VerificationResult[];
    commitSha: string | null;
    agentSummary: string | null;
}

interface WiggState {
    active: boolean;
    iteration: number;
    minIterations: number;
    maxIterations: number;
    completionPromise: string;
    tasksMode: boolean;
    taskPromise: string;
    task: string;
    startedAt: string;
    model: string;
    agent: string;
    verifyCommands: VerifyCommand[];
}

interface IterationHistory {
    iteration: number;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    exitCode: number;
    completionDetected: boolean;
    errors: string[];
    artifact?: IterationArtifact;
}

interface WiggHistory {
    iterations: IterationHistory[];
    totalDurationMs: number;
    struggleIndicators: {
        repeatedErrors: Record<string, number>;
        noProgressIterations: number;
        shortIterations: number;
    };
}

interface Task {
    text: string;
    status: 'todo' | 'in-progress' | 'complete';
    subtasks: Task[];
}

// ============================================================================
// Paths
// ============================================================================

// Resolve the target directory relative to the current working directory,
// so that when installed in node_modules, it targets the consuming project.
const ROOT_DIR = process.cwd();
const STATE_DIR = join(ROOT_DIR, '.wigg');
const STATE_PATH = join(STATE_DIR, 'wigg-loop.state.json');
const CONTEXT_PATH = join(STATE_DIR, 'wigg-context.md');
const HISTORY_PATH = join(STATE_DIR, 'wigg-history.json');
const TASKS_PATH = join(STATE_DIR, 'wigg-tasks.md');
const PROMPTS_DIR = join(__dirname, 'prompts');

// ============================================================================
// Utility Functions
// ============================================================================

function ensureDir(dir: string): void {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

function formatDurationShort(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAnsi(input: string): string {
    return input.replace(/\x1B\[[0-9;]*m/g, '');
}

// Simple color helpers
const c = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    gray: '\x1b[90m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m'
};

const clr = (color: string, text: string) =>
    process.stdout.isTTY ? `${color}${text}${c.reset}` : text;

// ============================================================================
// User Prompt
// ============================================================================

async function promptUser(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase());
        });
    });
}

type ActiveLoopChoice = 'new' | 'continue' | 'cancel';

async function promptActiveLoopChoice(
    existingState: WiggState
): Promise<ActiveLoopChoice> {
    const elapsed = Date.now() - new Date(existingState.startedAt).getTime();
    const agentName = AGENTS[existingState.agent]?.name ?? existingState.agent;

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                 Active Wigg Loop Detected                       ║
╚══════════════════════════════════════════════════════════════════╝

🔄 An active loop already exists:
   Iteration:   ${existingState.iteration}
   Started:     ${existingState.startedAt}
   Elapsed:     ${formatDuration(elapsed)}
   Agent:       ${agentName}
   Task:        ${existingState.task.substring(0, 50)}${existingState.task.length > 50 ? '...' : ''}

What would you like to do?
  [n] Start a NEW loop (discards current loop state)
  [c] CONTINUE the current loop
  [q] Cancel and exit
`);

    const answer = await promptUser('Your choice (n/c/q): ');

    switch (answer) {
        case 'n':
        case 'new':
            return 'new';
        case 'c':
        case 'continue':
            return 'continue';
        case 'q':
        case 'quit':
        case 'cancel':
        case '':
            return 'cancel';
        default:
            console.log(`Invalid choice: "${answer}". Cancelling.`);
            return 'cancel';
    }
}

// ============================================================================
// State Management
// ============================================================================

function loadState(): WiggState | null {
    if (!existsSync(STATE_PATH)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
        // Backward compat: older state files lack verifyCommands.
        if (!Array.isArray(parsed.verifyCommands)) {
            parsed.verifyCommands = [];
        }
        return parsed;
    } catch {
        return null;
    }
}

function saveState(state: WiggState): void {
    ensureDir(STATE_DIR);
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function clearState(): void {
    if (existsSync(STATE_PATH)) {
        try {
            unlinkSync(STATE_PATH);
        } catch {}
    }
}

// ============================================================================
// History Management
// ============================================================================

function loadHistory(): WiggHistory {
    if (!existsSync(HISTORY_PATH)) {
        return {
            iterations: [],
            totalDurationMs: 0,
            struggleIndicators: {
                repeatedErrors: {},
                noProgressIterations: 0,
                shortIterations: 0
            }
        };
    }
    try {
        return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'));
    } catch {
        return {
            iterations: [],
            totalDurationMs: 0,
            struggleIndicators: {
                repeatedErrors: {},
                noProgressIterations: 0,
                shortIterations: 0
            }
        };
    }
}

function saveHistory(history: WiggHistory): void {
    ensureDir(STATE_DIR);
    writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function clearHistory(): void {
    if (existsSync(HISTORY_PATH)) {
        try {
            unlinkSync(HISTORY_PATH);
        } catch {}
    }
}

// ============================================================================
// Context Management
// ============================================================================

function loadContext(): string | null {
    if (!existsSync(CONTEXT_PATH)) {
        return null;
    }
    try {
        const content = readFileSync(CONTEXT_PATH, 'utf-8').trim();
        return content || null;
    } catch {
        return null;
    }
}

function saveContext(text: string): void {
    ensureDir(STATE_DIR);
    const timestamp = new Date().toISOString();
    const entry = `\n## Context added at ${timestamp}\n${text}\n`;
    if (existsSync(CONTEXT_PATH)) {
        const existing = readFileSync(CONTEXT_PATH, 'utf-8');
        writeFileSync(CONTEXT_PATH, existing + entry);
    } else {
        writeFileSync(CONTEXT_PATH, `# Wigg Loop Context\n${entry}`);
    }
}

function clearContext(): void {
    if (existsSync(CONTEXT_PATH)) {
        try {
            unlinkSync(CONTEXT_PATH);
        } catch {}
    }
}

// ============================================================================
// Task Management
// ============================================================================

function parseTasks(content: string): Task[] {
    const tasks: Task[] = [];
    const lines = content.split('\n');
    let currentTask: Task | null = null;

    for (const line of lines) {
        const topLevelMatch = line.match(/^- \[([ x/])\]\s*(.+)/);
        if (topLevelMatch) {
            if (currentTask) {
                tasks.push(currentTask);
            }
            const [, statusChar, text] = topLevelMatch;
            let status: Task['status'] = 'todo';
            if (statusChar === 'x') {
                status = 'complete';
            } else if (statusChar === '/') {
                status = 'in-progress';
            }
            currentTask = { text, status, subtasks: [] };
            continue;
        }

        const subtaskMatch = line.match(/^\s+- \[([ x/])\]\s*(.+)/);
        if (subtaskMatch && currentTask) {
            const [, statusChar, text] = subtaskMatch;
            let status: Task['status'] = 'todo';
            if (statusChar === 'x') {
                status = 'complete';
            } else if (statusChar === '/') {
                status = 'in-progress';
            }
            currentTask.subtasks.push({ text, status, subtasks: [] });
        }
    }

    if (currentTask) {
        tasks.push(currentTask);
    }
    return tasks;
}

function loadTasks(): Task[] {
    if (!existsSync(TASKS_PATH)) {
        return [];
    }
    try {
        return parseTasks(readFileSync(TASKS_PATH, 'utf-8'));
    } catch {
        return [];
    }
}

function getTasksContent(): string {
    if (!existsSync(TASKS_PATH)) {
        return '';
    }
    return readFileSync(TASKS_PATH, 'utf-8');
}

function findCurrentTask(tasks: Task[]): Task | null {
    return tasks.find(t => t.status === 'in-progress') || null;
}

function findNextTask(tasks: Task[]): Task | null {
    return tasks.find(t => t.status === 'todo') || null;
}

function allTasksComplete(tasks: Task[]): boolean {
    return tasks.length > 0 && tasks.every(t => t.status === 'complete');
}

function addTask(description: string): void {
    ensureDir(STATE_DIR);
    let content = '';
    if (existsSync(TASKS_PATH)) {
        content = readFileSync(TASKS_PATH, 'utf-8');
    } else {
        content = '# Wigg Tasks\n\n';
    }
    writeFileSync(TASKS_PATH, content.trimEnd() + `\n- [ ] ${description}\n`);
}

// ============================================================================
// Prompt Template System
// ============================================================================

interface PromptContext {
    projectName: string;
    iteration: number;
    minIterations: number;
    maxIterations: number;
    task: string;
    completionPromise: string;
    taskPromise: string;
    context: string | null;
    tasksMode: boolean;
    tasksFile: string;
    tasksContent: string;
    currentTask: string | null;
    nextTask: string | null;
    allComplete: boolean;
    recentHistory: string | null;
}

function loadPromptTemplate(name: string): string {
    const path = join(PROMPTS_DIR, `${name}.md`);
    if (!existsSync(path)) {
        throw new Error(`Prompt template not found: ${path}`);
    }
    return readFileSync(path, 'utf-8');
}

function renderTemplate(template: string, ctx: PromptContext): string {
    let result = template;

    // Handle {{#if condition}}...{{else}}...{{/if}} blocks
    result = result.replace(
        /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
        (_, key, ifContent, elseContent = '') => {
            const value = (ctx as any as Record<string, unknown>)[key];
            return value ? ifContent : elseContent;
        }
    );

    // Handle simple {{variable}} replacements
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = (ctx as any as Record<string, unknown>)[key];
        return value !== null && value !== undefined ? String(value) : '';
    });

    return result.trim();
}

function getProjectName(): string {
    try {
        const pkgPath = join(ROOT_DIR, 'package.json');
        if (existsSync(pkgPath)) {
            const content = readFileSync(pkgPath, 'utf-8');
            const pkg = JSON.parse(content);
            if (pkg.name) {
                return pkg.name;
            }
        }
    } catch {}
    return basename(ROOT_DIR) || 'unknown-project';
}

function formatRecentHistory(
    history: WiggHistory,
    windowSize: number
): string | null {
    if (windowSize <= 0 || history.iterations.length === 0) {
        return null;
    }
    const recent = history.iterations.slice(-windowSize);
    const lines: string[] = [];
    for (const iter of recent) {
        const a = iter.artifact;
        const head = `Iteration ${iter.iteration} (${formatDurationShort(iter.durationMs)}, exit ${iter.exitCode}${iter.completionDetected ? ', completion-claimed' : ''})`;
        lines.push(head);
        if (a) {
            if (a.filesChanged.length === 0) {
                lines.push('  Changes: (no files changed)');
            } else {
                const preview = a.filesChanged.slice(0, 8).join(', ');
                const more =
                    a.filesChanged.length > 8
                        ? ` (+${a.filesChanged.length - 8} more)`
                        : '';
                lines.push(
                    `  Changes: ${a.filesChanged.length} files, +${a.linesAdded}/-${a.linesRemoved} [${preview}${more}]`
                );
            }
            if (a.commitSha) {
                lines.push(`  Commit:  ${a.commitSha.slice(0, 8)}`);
            }
            if (a.verifications.length > 0) {
                const verifyLine = a.verifications
                    .map(
                        v =>
                            `${v.label}=${v.exitCode === 0 ? 'pass' : `fail(${v.exitCode})`}`
                    )
                    .join(', ');
                lines.push(`  Verify:  ${verifyLine}`);
                for (const v of a.verifications) {
                    if (v.exitCode !== 0 && v.outputTail) {
                        const snippet = v.outputTail
                            .split('\n')
                            .slice(-6)
                            .join('\n    ');
                        lines.push(`    [${v.label} tail]\n    ${snippet}`);
                    }
                }
            }
        }
        if (iter.errors.length > 0 && (!a || a.verifications.length === 0)) {
            lines.push(`  Errors:  ${iter.errors.slice(0, 3).join(' | ')}`);
        }
    }
    return lines.join('\n');
}

function buildPrompt(
    state: WiggState,
    history: WiggHistory,
    historyWindow: number
): string {
    const tasks = loadTasks();
    const currentTask = findCurrentTask(tasks);
    const nextTask = findNextTask(tasks);

    const ctx: PromptContext = {
        projectName: getProjectName(),
        iteration: state.iteration,
        minIterations: state.minIterations,
        maxIterations: state.maxIterations,
        task: state.task,
        completionPromise: state.completionPromise,
        taskPromise: state.taskPromise,
        context: loadContext(),
        tasksMode: state.tasksMode,
        tasksFile: '.wigg/wigg-tasks.md',
        tasksContent: getTasksContent(),
        currentTask: currentTask?.text || null,
        nextTask: nextTask?.text || null,
        allComplete: allTasksComplete(tasks),
        recentHistory: formatRecentHistory(history, historyWindow)
    };

    const templateName = state.tasksMode ? 'tasks' : 'default';
    const template = loadPromptTemplate(templateName);
    let rendered = renderTemplate(template, ctx);

    // If the template doesn't reference {{recentHistory}} itself, auto-append it
    // so existing templates benefit without modification.
    if (ctx.recentHistory && !/\{\{\s*recentHistory\s*\}\}/.test(template)) {
        rendered += `\n\n---\n\n## Recent Iteration History (last ${Math.min(historyWindow, history.iterations.length)} iterations)\n\nUse this to avoid repeating work and to learn from prior attempts. Do NOT undo changes you made in previous iterations unless explicitly necessary.\n\n\`\`\`\n${ctx.recentHistory}\n\`\`\``;
    }

    return rendered;
}

// ============================================================================
// Agent Execution
// ============================================================================

function checkCompletion(output: string, promise: string): boolean {
    const pattern = new RegExp(
        `<promise>\\s*${escapeRegex(promise)}\\s*</promise>`,
        'i'
    );
    return pattern.test(output);
}

/**
 * For agents that emit stream-json (claude-code), the raw stdout contains
 * every tool_result and user-role message — including verbatim echoes of the
 * mission file when the agent reads it. That means a promise marker named
 * inside the mission's own "emit this when done" instructions would match the
 * completion regex on literally every iteration. Extract assistant-role text
 * blocks only, so completion detection sees the agent's own output, not its
 * inputs or tool results.
 *
 * Non-stream agents (opencode, codex) return raw text and the filter is a
 * no-op.
 */
function extractAssistantText(rawOutput: string, streamsJson: boolean): string {
    if (!streamsJson) {
        return rawOutput;
    }
    const parts: string[] = [];
    for (const line of rawOutput.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed[0] !== '{') {
            continue;
        }
        try {
            const evt = JSON.parse(trimmed);
            if (evt.type !== 'assistant') {
                continue;
            }
            const content = evt.message?.content;
            if (!Array.isArray(content)) {
                continue;
            }
            for (const block of content) {
                if (block.type === 'text' && typeof block.text === 'string') {
                    parts.push(block.text);
                }
            }
        } catch {
            // malformed NDJSON line — skip
        }
    }
    return parts.join('\n');
}

function extractErrors(output: string): string[] {
    const errors: string[] = [];
    const lines = output.split('\n');
    for (const line of lines) {
        const lower = line.toLowerCase();
        if (
            lower.includes('error:') ||
            lower.includes('failed:') ||
            lower.includes('exception:') ||
            lower.includes('typeerror') ||
            lower.includes('syntaxerror') ||
            lower.includes('referenceerror') ||
            (lower.includes('test') && lower.includes('fail'))
        ) {
            const cleaned = line.trim().substring(0, 200);
            if (cleaned && !errors.includes(cleaned)) {
                errors.push(cleaned);
            }
        }
    }
    return errors.slice(0, 10);
}

const PROMPT_FILE_PATH = join(STATE_DIR, 'current-prompt.md');
const ITERATIONS_LOG_DIR = join(STATE_DIR, 'iterations');
const LAST_OUTPUT_LOG = join(STATE_DIR, 'last-agent-output.log');

/**
 * Line-buffered formatter for Claude Code's `--output-format stream-json`.
 *
 * Each line on stdout is a JSON event. We only need a handful of fields to
 * give the operator a useful live view:
 *   - system.init   → model / session banner
 *   - assistant     → text deltas and tool_use invocations
 *   - user          → tool_result summaries (truncated)
 *   - result        → final summary (duration, cost, stop reason)
 *
 * We deliberately swallow parse errors and fall back to printing the raw
 * line, so a CLI version skew can't blind the operator.
 */
function createStreamJsonFormatter(
    sink: NodeJS.WritableStream
): (chunk: Buffer | string) => void {
    let buffer = '';
    const printEvent = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return;
        }
        if (trimmed[0] !== '{') {
            sink.write(`${line}\n`);
            return;
        }
        try {
            const evt = JSON.parse(trimmed);
            switch (evt.type) {
                case 'system': {
                    if (evt.subtype === 'init') {
                        const model = evt.model ?? '?';
                        const cwd = evt.cwd ?? '';
                        const msg = `session started · model=${model}${cwd ? ` · cwd=${cwd}` : ''}`;
                        sink.write(
                            `${clr(c.magenta, '[system]')} ${clr(c.gray, msg)}\n`
                        );
                    }
                    return;
                }
                case 'assistant': {
                    const content = evt.message?.content;
                    if (!Array.isArray(content)) {
                        return;
                    }
                    for (const block of content) {
                        if (
                            block.type === 'text' &&
                            typeof block.text === 'string'
                        ) {
                            sink.write(block.text);
                            if (!block.text.endsWith('\n')) {
                                sink.write('\n');
                            }
                        } else if (block.type === 'tool_use') {
                            const name = block.name ?? 'tool';
                            const input = block.input
                                ? summarizeToolInput(block.input)
                                : '';
                            sink.write(
                                `${clr(c.cyan, `[tool:${name}]`)} ${clr(c.gray, input)}\n`
                            );
                        } else if (
                            block.type === 'thinking' &&
                            typeof block.thinking === 'string'
                        ) {
                            // Keep thinking trace compact — first line only.
                            const firstLine = block.thinking
                                .split('\n', 1)[0]
                                .slice(0, 200);
                            sink.write(
                                clr(c.gray, `[thinking] ${firstLine}`) + '\n'
                            );
                        }
                    }
                    return;
                }
                case 'user': {
                    const content = evt.message?.content;
                    if (!Array.isArray(content)) {
                        return;
                    }
                    for (const block of content) {
                        if (block.type === 'tool_result') {
                            const resultText = extractToolResultText(
                                block.content
                            );
                            const firstLine = resultText
                                .split('\n', 1)[0]
                                .slice(0, 160);
                            const isError = block.is_error;
                            const prefix = clr(
                                isError ? c.red : c.green,
                                '[tool_result]'
                            );
                            const suffix = clr(
                                isError ? c.red : c.gray,
                                firstLine
                            );
                            sink.write(`${prefix} ${suffix}\n`);
                        }
                    }
                    return;
                }
                case 'result': {
                    const ms = evt.duration_ms ?? 0;
                    const turns = evt.num_turns ?? '?';
                    const cost =
                        typeof evt.total_cost_usd === 'number'
                            ? `$${evt.total_cost_usd.toFixed(4)}`
                            : '?';
                    const msg = `${formatDurationShort(ms)} · ${turns} turns · ${cost}`;
                    sink.write(
                        `${clr(c.magenta, '[result]')} ${clr(c.gray, msg)}\n`
                    );
                    return;
                }
                default:
                    return;
            }
        } catch {
            sink.write(`${line}\n`);
        }
    };

    return (chunk: Buffer | string) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            printEvent(line);
        }
    };
}

function summarizeToolInput(input: unknown): string {
    if (!input || typeof input !== 'object') {
        return '';
    }
    const obj = input as Record<string, unknown>;
    const keys = [
        'command',
        'file_path',
        'path',
        'pattern',
        'query',
        'url',
        'description'
    ];
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'string' && value.length > 0) {
            return `${key}=${value.slice(0, 160)}`;
        }
    }
    return Object.keys(obj).slice(0, 3).join(',');
}

function extractToolResultText(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(b =>
                b &&
                typeof b === 'object' &&
                typeof (b as { text?: unknown }).text === 'string'
                    ? (b as { text: string }).text
                    : ''
            )
            .join(' ');
    }
    return '';
}

async function runAgent(
    agent: AgentConfig,
    prompt: string,
    options: AgentOptions,
    iteration?: number
): Promise<{ output: string; exitCode: number }> {
    return new Promise(resolve => {
        let promptArg = prompt;

        // For agents that use prompt files, write the prompt to a file
        if (agent.usesPromptFile) {
            ensureDir(STATE_DIR);
            writeFileSync(PROMPT_FILE_PATH, prompt, 'utf-8');
            promptArg = PROMPT_FILE_PATH;
        }

        const args = agent.buildArgs(promptArg, options);
        const stdin = agent.usesStdin ? 'pipe' : 'inherit';
        const child = spawn(agent.command, args, {
            stdio: [stdin, 'pipe', 'pipe'],
            cwd: ROOT_DIR,
            shell: process.platform === 'win32' ? WIN_SHELL : false
        });

        if (agent.usesStdin) {
            // Write the full prompt to stdin, then close it so the agent knows EOF.
            // This bypasses Windows cmd.exe argv-length and newline-truncation bugs.
            try {
                child.stdin?.write(prompt);
                child.stdin?.end();
            } catch (err) {
                console.error('Failed to pipe prompt via stdin:', err);
            }
        }

        // Tee raw output to a per-iteration log file so the operator can tail it
        // from another terminal (e.g. `Get-Content -Wait .wigg/last-agent-output.log`).
        ensureDir(ITERATIONS_LOG_DIR);
        const iterLogPath =
            typeof iteration === 'number'
                ? join(
                      ITERATIONS_LOG_DIR,
                      `iter-${String(iteration).padStart(4, '0')}.log`
                  )
                : null;
        let iterLog: WriteStream | null = null;
        let lastLog: WriteStream | null = null;
        try {
            if (iterLogPath) {
                iterLog = createWriteStream(iterLogPath, { flags: 'w' });
            }
            lastLog = createWriteStream(LAST_OUTPUT_LOG, { flags: 'w' });
        } catch (err) {
            console.error('Failed to open agent log file:', err);
        }

        const formatStdout = agent.streamsJson
            ? createStreamJsonFormatter(process.stdout)
            : null;

        let output = '';

        child.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            output += text;
            iterLog?.write(data);
            lastLog?.write(data);
            if (formatStdout) {
                formatStdout(data);
            } else {
                process.stdout.write(text);
            }
        });

        child.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            output += text;
            iterLog?.write(data);
            lastLog?.write(data);
            process.stderr.write(text);
        });

        const finish = (code: number) => {
            iterLog?.end();
            lastLog?.end();
            resolve({ output, exitCode: code });
        };

        child.on('close', code => {
            finish(code ?? 0);
        });

        child.on('error', err => {
            console.error(`Failed to spawn ${agent.command}:`, err.message);
            finish(1);
        });

        // Handle SIGINT
        process.on('SIGINT', () => {
            child.kill('SIGINT');
        });
    });
}

// ============================================================================
// Git Operations
// ============================================================================

function runCommand(
    command: string,
    args: string[],
    opts: { cwd?: string; captureOnly?: boolean } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: opts.cwd ?? ROOT_DIR,
            stdio: 'pipe',
            shell: process.platform === 'win32' ? WIN_SHELL : false
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', data => {
            stdout += data.toString();
        });
        child.stderr?.on('data', data => {
            stderr += data.toString();
        });
        child.on('close', code =>
            resolve({ stdout, stderr, exitCode: code ?? 0 })
        );
        child.on('error', err =>
            resolve({ stdout, stderr: String(err), exitCode: 1 })
        );
    });
}

async function getGitHead(): Promise<string | null> {
    const { stdout, exitCode } = await runCommand('git', ['rev-parse', 'HEAD']);
    if (exitCode !== 0) {
        return null;
    }
    return stdout.trim() || null;
}

interface DiffStats {
    filesChanged: string[];
    linesAdded: number;
    linesRemoved: number;
    diffStat: string;
}

async function getDiffStats(baseSha: string | null): Promise<DiffStats> {
    const empty: DiffStats = {
        filesChanged: [],
        linesAdded: 0,
        linesRemoved: 0,
        diffStat: ''
    };
    // numstat gives us file-level add/remove counts; include both committed diff since base
    // and any currently-unstaged changes.
    const spec = baseSha ? [`${baseSha}..HEAD`] : [];
    const committed = baseSha
        ? await runCommand('git', ['diff', '--numstat', ...spec])
        : { stdout: '', exitCode: 0, stderr: '' };
    const working = await runCommand('git', ['diff', '--numstat', 'HEAD']);
    const untracked = await runCommand('git', [
        'ls-files',
        '--others',
        '--exclude-standard'
    ]);
    const statPretty = baseSha
        ? await runCommand('git', ['diff', '--stat', `${baseSha}..HEAD`])
        : { stdout: '', exitCode: 0, stderr: '' };
    const statWorking = await runCommand('git', ['diff', '--stat', 'HEAD']);

    const fileSet = new Set<string>();
    let added = 0;
    let removed = 0;

    const parseNumstat = (text: string) => {
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }
            const parts = trimmed.split(/\s+/);
            if (parts.length < 3) {
                continue;
            }
            const [a, r, ...fileParts] = parts;
            const file = fileParts.join(' ');
            if (a !== '-') {
                added += parseInt(a, 10) || 0;
            }
            if (r !== '-') {
                removed += parseInt(r, 10) || 0;
            }
            fileSet.add(file);
        }
    };

    if (committed.exitCode === 0) {
        parseNumstat(committed.stdout);
    }
    if (working.exitCode === 0) {
        parseNumstat(working.stdout);
    }
    if (untracked.exitCode === 0) {
        for (const line of untracked.stdout.split('\n')) {
            const f = line.trim();
            if (f) {
                fileSet.add(f);
            }
        }
    }

    if (fileSet.size === 0) {
        return empty;
    }

    const diffStat = [statPretty.stdout.trim(), statWorking.stdout.trim()]
        .filter(Boolean)
        .join('\n');

    return {
        filesChanged: Array.from(fileSet),
        linesAdded: added,
        linesRemoved: removed,
        diffStat
    };
}

async function gitCommit(
    headerMessage: string,
    bodyMessage?: string
): Promise<string | null> {
    const add = await runCommand('git', ['add', '-A']);
    if (add.exitCode !== 0) {
        return null;
    }
    const args = ['commit', '-m', headerMessage];
    if (bodyMessage) {
        args.push('-m', bodyMessage);
    }
    const commit = await runCommand('git', args);
    if (commit.exitCode !== 0) {
        return null;
    }
    return await getGitHead();
}

async function hasGitChanges(): Promise<boolean> {
    const { stdout } = await runCommand('git', ['status', '--porcelain']);
    return stdout.trim().length > 0;
}

// ============================================================================
// Verification Commands
// ============================================================================

function parseVerifyArg(raw: string): VerifyCommand {
    // Accepted forms:
    //   "label:command with args"   → split on first ":"
    //   "command with args"         → label derived from first token
    const colonIdx = raw.indexOf(':');
    if (colonIdx > 0) {
        const label = raw.slice(0, colonIdx).trim();
        const command = raw.slice(colonIdx + 1).trim();
        if (label && command && !label.includes(' ')) {
            return { label, command };
        }
    }
    const firstToken = raw.trim().split(/\s+/)[0] || 'verify';
    return { label: firstToken, command: raw.trim() };
}

async function runVerifyCommand(v: VerifyCommand): Promise<VerificationResult> {
    const start = Date.now();
    const result = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>(resolve => {
        const child = spawn(v.command, {
            cwd: ROOT_DIR,
            stdio: 'pipe',
            shell: WIN_SHELL // pwsh on Windows (where available), /bin/sh elsewhere
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', d => {
            stdout += d.toString();
        });
        child.stderr?.on('data', d => {
            stderr += d.toString();
        });
        child.on('close', code =>
            resolve({ stdout, stderr, exitCode: code ?? 0 })
        );
        child.on('error', err =>
            resolve({ stdout: '', stderr: String(err), exitCode: 1 })
        );
    });
    const combined = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
    const tail = combined.length > 800 ? combined.slice(-800) : combined;
    return {
        label: v.label,
        command: v.command,
        exitCode: result.exitCode,
        durationMs: Date.now() - start,
        outputTail: tail
    };
}

async function runVerifications(
    commands: VerifyCommand[]
): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];
    for (const cmd of commands) {
        console.log(`\n🧪 Verifying [${cmd.label}]: ${cmd.command}`);
        const result = await runVerifyCommand(cmd);
        const icon = result.exitCode === 0 ? '✅' : '❌';
        console.log(
            `   ${icon} ${cmd.label} (exit ${result.exitCode}, ${formatDurationShort(result.durationMs)})`
        );
        results.push(result);
    }
    return results;
}

// ============================================================================
// CLI Commands
// ============================================================================

function printHelp(): void {
    console.log(`
Wigg Loop - Iterative Agentic Development Harness

Usage:
  pnpm wigg "<task>" [options]
  npx tsx tools/wigg.ts "<task>" [options]

Arguments:
  task                Task description for the AI to work on

Options:
  --agent AGENT       AI agent: opencode (default), claude-code, codex
  --min-iterations N  Minimum iterations before completion (default: 1)
  --max-iterations N  Maximum iterations before stopping (default: unlimited)
  --completion-promise TEXT  Phrase that signals completion (default: COMPLETE)
  --tasks, -t         Enable Tasks Mode for structured task tracking
  --task-promise TEXT Phrase for task completion (default: READY_FOR_NEXT_TASK)
  --model MODEL       Model to use (agent-specific)
  --no-commit         Don't auto-commit after each iteration
  --allow-all         Auto-approve all tool permissions (default: on)
  --no-allow-all      Require interactive permission prompts
  --verify "LABEL:CMD" Run a verification command after each iteration.
                      Repeatable. Results feed back into the next prompt and
                      gate completion. Example:
                        --verify "test:pnpm test" --verify "types:pnpm typecheck"
                      If LABEL: is omitted, the first token of CMD is used.
  --history-window N  Number of prior iterations to summarize in the next
                      prompt (default: 5, use 0 to disable)
  --mission-file, -m FILE  Read the mission text from FILE instead of argv.
                      Use this for long, multi-line missions. The file path
                      is a short single-line arg, so it survives the Windows
                      npx.cmd shim; the file contents are read in Node.
  --version, -v       Show version
  --help, -h          Show this help

Commands:
  --status            Show current Wigg loop status and history
  --add-context TEXT  Add context for the next iteration
  --clear-context     Clear any pending context
  --list-tasks        Display the current task list
  --add-task "desc"   Add a new task to the list

Active Loop Behavior:
  If a loop is already active, you will be prompted to:
  - Start a NEW loop (discards current state)
  - CONTINUE the current loop
  - Cancel and exit

Examples:
  pnpm wigg "Add dark mode support to the ui"
  pnpm wigg "Fix the auth bug" --max-iterations 10
  pnpm wigg --tasks "Implement new features from PRD"
  pnpm wigg --status
  pnpm wigg --add-context "Focus on the map component first"
`);
}

function printStatus(): void {
    const state = loadState();
    const history = loadHistory();
    const context = loadContext();

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Wigg Loop Status                              ║
╚══════════════════════════════════════════════════════════════════╝
`);

    if (state?.active) {
        const elapsed = Date.now() - new Date(state.startedAt).getTime();
        const agentName = AGENTS[state.agent]?.name ?? state.agent;
        const iterInfo =
            state.maxIterations > 0
                ? ` / ${state.maxIterations}`
                : ' (unlimited)';
        console.log(`🔄 ACTIVE LOOP`);
        console.log(`   Iteration:    ${state.iteration}${iterInfo}`);
        console.log(`   Started:      ${state.startedAt}`);
        console.log(`   Elapsed:      ${formatDuration(elapsed)}`);
        console.log(`   Promise:      ${state.completionPromise}`);
        console.log(`   Agent:        ${agentName}`);
        if (state.model) {
            console.log(`   Model:        ${state.model}`);
        }
        if (state.tasksMode) {
            console.log(`   Tasks Mode:   ENABLED`);
            console.log(`   Task Promise: ${state.taskPromise}`);
        }
        console.log(
            `   Task:         ${state.task.substring(0, 60)}${state.task.length > 60 ? '...' : ''}`
        );
    } else {
        console.log(`⏹️  No active loop`);
    }

    if (context) {
        console.log(`\n📝 PENDING CONTEXT:`);
        console.log(`   ${context.split('\n').slice(0, 5).join('\n   ')}`);
    }

    // Show tasks
    const tasks = loadTasks();
    if (tasks.length > 0) {
        console.log(`\n📋 TASKS:`);
        tasks.forEach((task, i) => {
            const icon =
                task.status === 'complete'
                    ? '✅'
                    : task.status === 'in-progress'
                      ? '🔄'
                      : '⏸️';
            console.log(`   ${i + 1}. ${icon} ${task.text}`);
            task.subtasks.forEach(sub => {
                const subIcon =
                    sub.status === 'complete'
                        ? '✅'
                        : sub.status === 'in-progress'
                          ? '🔄'
                          : '⏸️';
                console.log(`      ${subIcon} ${sub.text}`);
            });
        });
        const complete = tasks.filter(t => t.status === 'complete').length;
        const inProgress = tasks.filter(t => t.status === 'in-progress').length;
        console.log(
            `\n   Progress: ${complete}/${tasks.length} complete, ${inProgress} in progress`
        );
    }

    if (history.iterations.length > 0) {
        console.log(`\n📊 HISTORY (${history.iterations.length} iterations)`);
        console.log(
            `   Total time: ${formatDuration(history.totalDurationMs)}`
        );

        const recent = history.iterations.slice(-5);
        console.log(`\n   Recent iterations:`);
        for (const iter of recent) {
            const status = iter.completionDetected
                ? '✅'
                : iter.exitCode !== 0
                  ? '❌'
                  : '🔄';
            console.log(
                `   ${status} #${iter.iteration}: ${formatDuration(iter.durationMs)}`
            );
        }

        const struggle = history.struggleIndicators;
        if (
            struggle.noProgressIterations >= 3 ||
            struggle.shortIterations >= 3
        ) {
            console.log(`\n⚠️  STRUGGLE INDICATORS:`);
            if (struggle.noProgressIterations >= 3) {
                console.log(
                    `   - No progress in ${struggle.noProgressIterations} iterations`
                );
            }
            if (struggle.shortIterations >= 3) {
                console.log(
                    `   - ${struggle.shortIterations} very short iterations (< 30s)`
                );
            }
            console.log(
                `\n   💡 Try: pnpm wigg --add-context "your hint here"`
            );
        }
    }

    console.log('');
}

function printTasks(): void {
    const tasks = loadTasks();
    if (tasks.length === 0) {
        console.log(
            'No tasks found. Use --add-task to create your first task.'
        );
        return;
    }

    console.log('Current tasks:');
    tasks.forEach((task, i) => {
        const icon =
            task.status === 'complete'
                ? '✅'
                : task.status === 'in-progress'
                  ? '🔄'
                  : '⏸️';
        console.log(`${i + 1}. ${icon} ${task.text}`);
        task.subtasks.forEach(sub => {
            const subIcon =
                sub.status === 'complete'
                    ? '✅'
                    : sub.status === 'in-progress'
                      ? '🔄'
                      : '⏸️';
            console.log(`   ${subIcon} ${sub.text}`);
        });
    });
}

// ============================================================================
// Main Loop
// ============================================================================

interface CliOptions {
    task: string;
    agent: string;
    model: string;
    minIterations: number;
    maxIterations: number;
    completionPromise: string;
    tasksMode: boolean;
    taskPromise: string;
    autoCommit: boolean;
    allowAll: boolean;
    verifyCommands: VerifyCommand[];
    historyWindow: number;
}

async function runLoop(options: CliOptions): Promise<void> {
    const existingState = loadState();
    let state: WiggState;

    if (existingState?.active) {
        const choice = await promptActiveLoopChoice(existingState);

        switch (choice) {
            case 'cancel':
                console.log('Cancelled.');
                process.exit(0);
                break;
            case 'continue':
                console.log('\n▶️  Continuing existing loop...\n');
                state = existingState;
                // Let user override verify commands on resume if they pass new ones.
                if (options.verifyCommands.length > 0) {
                    state.verifyCommands = options.verifyCommands;
                }
                break;
            case 'new':
                console.log(
                    '\n🔄 Starting new loop (discarding previous state)...\n'
                );
                clearState();
                clearHistory();
                clearContext();
                state = {
                    active: true,
                    iteration: 1,
                    minIterations: options.minIterations,
                    maxIterations: options.maxIterations,
                    completionPromise: options.completionPromise,
                    tasksMode: options.tasksMode,
                    taskPromise: options.taskPromise,
                    task: options.task,
                    startedAt: new Date().toISOString(),
                    model: options.model,
                    agent: options.agent,
                    verifyCommands: options.verifyCommands
                };
                break;
        }
    } else {
        state = {
            active: true,
            iteration: 1,
            minIterations: options.minIterations,
            maxIterations: options.maxIterations,
            completionPromise: options.completionPromise,
            tasksMode: options.tasksMode,
            taskPromise: options.taskPromise,
            task: options.task,
            startedAt: new Date().toISOString(),
            model: options.model,
            agent: options.agent,
            verifyCommands: options.verifyCommands
        };
    }

    const agentConfig = AGENTS[state.agent];
    if (!agentConfig) {
        console.error(`Unknown agent: ${state.agent}`);
        console.error(`Available agents: ${Object.keys(AGENTS).join(', ')}`);
        process.exit(1);
    }

    saveState(state);

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    Wigg Loop                                    ║
║         Iterative AI Development with ${agentConfig.name.padEnd(20, ' ')}       ║
╚══════════════════════════════════════════════════════════════════╝
`);

    // Initialize tasks file if needed
    if (state.tasksMode && !existsSync(TASKS_PATH)) {
        ensureDir(STATE_DIR);
        writeFileSync(
            TASKS_PATH,
            '# Wigg Tasks\n\nAdd tasks below:\n- [ ] First task\n'
        );
        console.log(`📋 Created tasks file: ${TASKS_PATH}`);
    }

    // Initialize history
    const history = loadHistory();

    const taskPreview =
        state.task.substring(0, 80) + (state.task.length > 80 ? '...' : '');
    console.log(`Task: ${taskPreview}`);
    console.log(`Completion promise: ${state.completionPromise}`);
    if (state.tasksMode) {
        console.log(`Tasks mode: ENABLED`);
        console.log(`Task promise: ${state.taskPromise}`);
    }
    console.log(`Min iterations: ${state.minIterations}`);
    console.log(
        `Max iterations: ${state.maxIterations > 0 ? state.maxIterations : 'unlimited'}`
    );
    console.log(`Agent: ${agentConfig.name}`);
    if (state.model) {
        console.log(`Model: ${state.model}`);
    }
    if (options.allowAll) {
        console.log('Permissions: auto-approve all tools');
    }
    if (process.platform === 'win32') {
        const shellLabel =
            typeof WIN_SHELL === 'string'
                ? WIN_SHELL
                : 'cmd.exe (Node default)';
        console.log(`Shell: ${shellLabel}`);
    }
    if (state.verifyCommands.length > 0) {
        console.log(`Verify commands:`);
        for (const v of state.verifyCommands) {
            console.log(`  - [${v.label}] ${v.command}`);
        }
    }
    if (options.historyWindow > 0) {
        console.log(
            `History window: last ${options.historyWindow} iterations fed to prompt`
        );
    }
    if (state.iteration > 1) {
        console.log(`Resuming at iteration: ${state.iteration}`);
    }
    console.log('');
    console.log('Starting loop... (Ctrl+C to stop)');
    console.log('═'.repeat(68));

    // Graceful shutdown
    let stopping = false;
    process.on('SIGINT', () => {
        if (stopping) {
            console.log('\nForce stopping...');
            process.exit(1);
        }
        stopping = true;
        console.log('\nGracefully stopping Wigg loop...');
        clearState();
        console.log('Loop cancelled.');
        process.exit(0);
    });

    // Main loop
    while (true) {
        if (stopping) {
            break;
        }

        if (state.maxIterations > 0 && state.iteration > state.maxIterations) {
            console.log(
                `\n╔══════════════════════════════════════════════════════════════════╗`
            );
            console.log(
                `║  Max iterations (${state.maxIterations}) reached. Loop stopped.`
            );
            console.log(
                `║  Total time: ${formatDuration(history.totalDurationMs)}`
            );
            console.log(
                `╚══════════════════════════════════════════════════════════════════╝`
            );
            clearState();
            break;
        }

        const iterInfo =
            state.maxIterations > 0 ? ` / ${state.maxIterations}` : '';
        const minInfo =
            state.iteration < state.minIterations
                ? ` (min: ${state.minIterations})`
                : '';
        console.log(
            clr(
                c.magenta,
                `\n🔄 Iteration ${state.iteration}${iterInfo}${minInfo}`
            )
        );
        console.log(
            clr(
                c.dim,
                '────────────────────────────────────────────────────────────────────'
            )
        );
        console.log('─'.repeat(68));

        const contextAtStart = loadContext();
        const iterationStart = Date.now();
        const baseSha = await getGitHead();

        try {
            const fullPrompt = buildPrompt(
                state,
                history,
                options.historyWindow
            );

            const { output, exitCode } = await runAgent(
                agentConfig,
                fullPrompt,
                {
                    model: state.model,
                    allowAll: options.allowAll
                },
                state.iteration
            );

            const completionText = extractAssistantText(
                output,
                agentConfig.streamsJson ?? false
            );
            const completionDetected = checkCompletion(
                completionText,
                state.completionPromise
            );
            const taskCompletionDetected = state.tasksMode
                ? checkCompletion(completionText, state.taskPromise)
                : false;

            const iterationDuration = Date.now() - iterationStart;

            // Capture diff since baseline (includes both uncommitted work and any
            // commits the agent made mid-iteration).
            const diff = await getDiffStats(baseSha);

            // Run verification commands (tests / lint / typecheck / etc.).
            const verifications =
                state.verifyCommands.length > 0
                    ? await runVerifications(state.verifyCommands)
                    : [];
            const allVerifiesPassed = verifications.every(
                v => v.exitCode === 0
            );

            console.log(clr(c.magenta, '\nIteration Summary'));
            console.log(
                clr(
                    c.dim,
                    '────────────────────────────────────────────────────────────────────'
                )
            );
            console.log(`${clr(c.gray, 'Iteration:')} ${state.iteration}`);
            console.log(
                `${clr(c.gray, 'Elapsed:')}   ${formatDurationShort(iterationDuration)}`
            );
            console.log(
                `${clr(c.gray, 'Exit code:')} ${exitCode === 0 ? clr(c.green, '0') : clr(c.red, exitCode.toString())}`
            );
            console.log(
                `${clr(c.gray, 'Completion promise:')} ${completionDetected ? clr(c.green, 'detected') : clr(c.yellow, 'not detected')}`
            );
            console.log(
                `${clr(c.gray, 'Changes:')}   ${diff.filesChanged.length} files, +${diff.linesAdded}/-${diff.linesRemoved}`
            );
            if (verifications.length > 0) {
                const passCount = verifications.filter(
                    v => v.exitCode === 0
                ).length;
                console.log(
                    `${clr(c.gray, 'Verify:')}    ${passCount}/${verifications.length} passed`
                );
            }

            // Auto-commit BEFORE building the artifact so the artifact records the
            // resulting commit SHA (for meaningful history and reproducibility).
            let commitSha: string | null = null;
            if (
                options.autoCommit &&
                diff.filesChanged.length > 0 &&
                (await hasGitChanges())
            ) {
                const verifySummary =
                    verifications.length > 0
                        ? verifications
                              .map(
                                  v =>
                                      `${v.label}:${v.exitCode === 0 ? 'pass' : 'fail'}`
                              )
                              .join(' ')
                        : '';
                const header = `wigg(iter ${state.iteration}): ${diff.filesChanged.length} files +${diff.linesAdded}/-${diff.linesRemoved}${verifySummary ? ` [${verifySummary}]` : ''}`;
                const bodyParts: string[] = [];
                if (diff.filesChanged.length > 0) {
                    bodyParts.push(
                        `Files:\n${diff.filesChanged
                            .slice(0, 20)
                            .map(f => ` - ${f}`)
                            .join('\n')}`
                    );
                }
                if (verifications.length > 0) {
                    bodyParts.push(
                        `Verifications:\n${verifications
                            .map(
                                v =>
                                    ` - ${v.label} (${v.command}): exit ${v.exitCode} in ${formatDurationShort(v.durationMs)}`
                            )
                            .join('\n')}`
                    );
                }
                if (completionDetected) {
                    bodyParts.push(`Agent claimed completion.`);
                }
                commitSha = await gitCommit(
                    header.slice(0, 100),
                    bodyParts.join('\n\n')
                );
                if (commitSha) {
                    console.log(`📝 Committed ${commitSha.slice(0, 8)}`);
                }
            }

            const agentSummary = stripAnsi(output)
                .trim()
                .split('\n')
                .slice(-20)
                .join('\n')
                .slice(-2000);

            const artifact: IterationArtifact = {
                baseSha,
                headSha: commitSha ?? (await getGitHead()),
                filesChanged: diff.filesChanged,
                linesAdded: diff.linesAdded,
                linesRemoved: diff.linesRemoved,
                diffStat: diff.diffStat,
                verifications,
                commitSha,
                agentSummary: agentSummary || null
            };

            // Track history
            const errors = extractErrors(output);
            const iterationRecord: IterationHistory = {
                iteration: state.iteration,
                startedAt: new Date(iterationStart).toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: iterationDuration,
                exitCode,
                completionDetected,
                errors,
                artifact
            };

            history.iterations.push(iterationRecord);
            history.totalDurationMs += iterationDuration;

            // Update struggle indicators using REAL signals, not duration alone.
            // "No progress" = no files changed AND no verify improvement.
            if (diff.filesChanged.length === 0) {
                history.struggleIndicators.noProgressIterations++;
            } else {
                history.struggleIndicators.noProgressIterations = 0;
            }

            // Keep the short-iteration indicator but weight it less (only count if
            // also no files changed, otherwise a fast successful fix is fine).
            if (iterationDuration < 30000 && diff.filesChanged.length === 0) {
                history.struggleIndicators.shortIterations++;
            } else {
                history.struggleIndicators.shortIterations = 0;
            }

            // Track repeated verification failures as the primary error signal.
            const failedVerifies = verifications.filter(v => v.exitCode !== 0);
            if (failedVerifies.length === 0 && errors.length === 0) {
                history.struggleIndicators.repeatedErrors = {};
            } else {
                for (const v of failedVerifies) {
                    const key = `${v.label}:${v.outputTail.slice(-120)}`;
                    history.struggleIndicators.repeatedErrors[key] =
                        (history.struggleIndicators.repeatedErrors[key] || 0) +
                        1;
                }
            }

            saveHistory(history);

            // Struggle warning
            const struggle = history.struggleIndicators;
            if (
                state.iteration > 2 &&
                (struggle.noProgressIterations >= 3 ||
                    struggle.shortIterations >= 3 ||
                    Object.values(struggle.repeatedErrors).some(n => n >= 3))
            ) {
                console.log(`\n⚠️  Potential struggle detected:`);
                if (struggle.noProgressIterations >= 3) {
                    console.log(
                        `   - ${struggle.noProgressIterations} iterations with no file changes`
                    );
                }
                if (struggle.shortIterations >= 3) {
                    console.log(
                        `   - ${struggle.shortIterations} short, no-change iterations`
                    );
                }
                const repeated = Object.entries(struggle.repeatedErrors).filter(
                    ([, n]) => n >= 3
                );
                if (repeated.length > 0) {
                    console.log(
                        `   - Repeated verification failures: ${repeated
                            .map(([k]) => k.split(':')[0])
                            .join(', ')}`
                    );
                }
                console.log(
                    `   💡 Tip: Use 'pnpm wigg --add-context "hint"' in another terminal`
                );
            }

            if (exitCode !== 0) {
                console.warn(
                    `\n⚠️  ${agentConfig.name} exited with code ${exitCode}. Continuing...`
                );
            }

            // Task completion
            if (taskCompletionDetected && !completionDetected) {
                console.log(
                    `\n${clr(c.cyan, '🔄 Task completion detected. Moving to next task...')}`
                );
            }

            // Full completion - gated on verifications passing
            if (completionDetected) {
                if (state.iteration < state.minIterations) {
                    console.log(
                        `\n⏳ Completion detected, but minimum iterations (${state.minIterations}) not reached.`
                    );
                    console.log(
                        `   Continuing to iteration ${state.iteration + 1}...`
                    );
                } else if (!allVerifiesPassed) {
                    const failed = verifications
                        .filter(v => v.exitCode !== 0)
                        .map(v => v.label)
                        .join(', ');
                    console.log(
                        `\n⚠️  Agent claimed completion but verifications failed: ${failed}. Continuing loop.`
                    );
                } else {
                    console.log(
                        `
╔══════════════════════════════════════════════════════════════════╗
║  ✅ Completion promise detected!                                 ║
║  Task completed in ${state.iteration} iteration(s)               ║
║  Total time: ${formatDuration(history.totalDurationMs)}          ║
╚══════════════════════════════════════════════════════════════════╝
`
                    );
                    clearState();
                    clearHistory();
                    clearContext();
                    break;
                }
            }

            // Clear consumed context
            if (contextAtStart) {
                console.log(`📝 Context was consumed this iteration`);
                clearContext();
            }

            // Next iteration
            state.iteration++;
            saveState(state);

            // Small delay
            await new Promise(r => setTimeout(r, 1000));
        } catch (error) {
            console.error(`\n❌ Error in iteration ${state.iteration}:`, error);
            console.log('Continuing to next iteration...');

            const iterationDuration = Date.now() - iterationStart;
            history.iterations.push({
                iteration: state.iteration,
                startedAt: new Date(iterationStart).toISOString(),
                endedAt: new Date().toISOString(),
                durationMs: iterationDuration,
                exitCode: -1,
                completionDetected: false,
                errors: [String(error).substring(0, 200)]
            });
            history.totalDurationMs += iterationDuration;
            saveHistory(history);

            state.iteration++;
            saveState(state);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    // Handle --help
    if (args.includes('--help') || args.includes('-h')) {
        printHelp();
        process.exit(0);
    }

    // Handle --version
    if (args.includes('--version') || args.includes('-v')) {
        console.log(`wigg ${VERSION}`);
        process.exit(0);
    }

    // Handle --status
    if (args.includes('--status')) {
        printStatus();
        process.exit(0);
    }

    // Handle --list-tasks
    if (args.includes('--list-tasks')) {
        printTasks();
        process.exit(0);
    }

    // Handle --add-context
    const addContextIdx = args.indexOf('--add-context');
    if (addContextIdx !== -1) {
        const text = args[addContextIdx + 1];
        if (!text) {
            console.error('Error: --add-context requires a text argument');
            process.exit(1);
        }
        saveContext(text);
        console.log(`✅ Context added for next iteration`);
        const state = loadState();
        if (state?.active) {
            console.log(
                `   Will be picked up in iteration ${state.iteration + 1}`
            );
        }
        process.exit(0);
    }

    // Handle --clear-context
    if (args.includes('--clear-context')) {
        clearContext();
        console.log(`✅ Context cleared`);
        process.exit(0);
    }

    // Handle --add-task
    const addTaskIdx = args.indexOf('--add-task');
    if (addTaskIdx !== -1) {
        const description = args[addTaskIdx + 1];
        if (!description) {
            console.error('Error: --add-task requires a description');
            process.exit(1);
        }
        addTask(description);
        console.log(`✅ Task added: "${description}"`);
        process.exit(0);
    }

    // Parse main options
    const options: CliOptions = {
        task: '',
        agent: 'claude-code',
        model: '',
        minIterations: 1,
        maxIterations: 0,
        completionPromise: 'COMPLETE',
        tasksMode: false,
        taskPromise: 'READY_FOR_NEXT_TASK',
        autoCommit: true,
        allowAll: true,
        verifyCommands: [],
        historyWindow: 5
    };

    const taskParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--agent') {
            options.agent = args[++i] || '';
        } else if (arg === '--model') {
            options.model = args[++i] || '';
        } else if (arg === '--min-iterations') {
            options.minIterations = parseInt(args[++i], 10) || 1;
        } else if (arg === '--max-iterations') {
            options.maxIterations = parseInt(args[++i], 10) || 0;
        } else if (arg === '--completion-promise') {
            options.completionPromise = args[++i] || 'COMPLETE';
        } else if (arg === '--tasks' || arg === '-t') {
            options.tasksMode = true;
        } else if (arg === '--task-promise') {
            options.taskPromise = args[++i] || 'READY_FOR_NEXT_TASK';
        } else if (arg === '--no-commit') {
            options.autoCommit = false;
        } else if (arg === '--allow-all') {
            options.allowAll = true;
        } else if (arg === '--no-allow-all') {
            options.allowAll = false;
        } else if (arg === '--verify') {
            const raw = args[++i];
            if (raw) {
                options.verifyCommands.push(parseVerifyArg(raw));
            }
        } else if (arg === '--history-window') {
            const n = parseInt(args[++i], 10);
            options.historyWindow = Number.isFinite(n) && n >= 0 ? n : 5;
        } else if (arg === '--mission-file' || arg === '-m') {
            const path = args[++i];
            if (!path) {
                console.error('Error: --mission-file requires a path argument');
                process.exit(1);
            }
            if (!existsSync(path)) {
                console.error(`Error: mission file not found: ${path}`);
                process.exit(1);
            }
            // Reading the file here (instead of passing multi-line text through
            // argv) dodges the Windows npx.cmd / cmd.exe newline-mangling trap
            // that would otherwise truncate the mission at its first newline.
            options.task = readFileSync(path, 'utf8').trim();
        } else if (!arg.startsWith('-')) {
            taskParts.push(arg);
        }
    }

    if (!options.task) {
        options.task = taskParts.join(' ');
    }

    if (!options.task) {
        console.error('Error: No task provided');
        console.error('Usage: pnpm wigg "Your task description" [options]');
        console.error('       pnpm wigg -m path/to/mission.md [options]');
        console.error("Run 'pnpm wigg --help' for more information");
        process.exit(1);
    }

    if (
        options.maxIterations > 0 &&
        options.minIterations > options.maxIterations
    ) {
        console.error(
            `Error: --min-iterations (${options.minIterations}) cannot exceed --max-iterations (${options.maxIterations})`
        );
        process.exit(1);
    }

    await runLoop(options);
}

main().catch(error => {
    console.error('Fatal error:', error);
    clearState();
    process.exit(1);
});
