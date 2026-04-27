# wigg

A pure TS Ralph Wiggum-like harness for NodeJS for iterative agentic coding. It runs an AI agent in a self-correcting loop until task completion.

## Installation

You can install it globally or run it via `npx` / `pnpm dlx`:

```bash
# Using npm
npm install -g @cbnsndwch/wigg

# Using pnpm
pnpm add -g @cbnsndwch/wigg
```

## Usage

```bash
# If installed globally
wigg "Your task description" [options]

# Via npx / pnpm dlx
npx @cbnsndwch/wigg "Your task description" [options]
```

## Features

- **Pure TypeScript / NodeJS:** No complex setup required.
- **Iterative Loop:** Runs until your task is fully completed or corrected.
- **Self-correcting:** Evaluates AI output and iterates.

## Supported Agent CLIs

`wigg` can wrap and orchestrate several AI agent CLIs under the hood:

- **Claude Code** (`claude`): Pipes input via `stdin` and reads streaming JSON (`claude -p`).
- **OpenCode** (`opencode`): Uses file-based prompts (`opencode run ... -f <file>`).
- **OpenAI Codex** (`codex`): Executes via `codex exec`.

CLI arguments like `--model` or `--allow-all` (which maps to flags like `--dangerously-skip-permissions` for Claude Code or `--full-auto` for Codex) can be passed to configure the underlying agent execution.

## Configuration & Options

`wigg` exposes several options to customize its execution:

- `--agent AGENT`: Choose the AI agent to use (`opencode` [default], `claude-code`, `codex`).
- `--model MODEL`: Pass a specific underlying model to the agent.
- `--max-iterations N` / `--min-iterations N`: Configure the limits for the iteration loop (default min: 1, max: unlimited).
- `--mission-file, -m FILE`: Load the task description from a file instead of a command-line string (useful for long, multi-line instructions).
- `--no-commit`: Do not automatically commit changes after each iteration.

## Verification Commands (`--verify`)

You can define automated checks running after each iteration. The output is fed back to the agent before it evaluates if the task is genuinely complete.

```bash
# Provide a label and a shell command to execute
wigg "Refactor the login component" --verify "test:pnpm test" --verify "typecheck:pnpm typecheck"
```

If the `test` or `typecheck` commands fail, the agent will see the errors and attempt to fix them in the subsequent iteration.

## Tasks Mode (`--tasks` / `-t`)

For complex, multi-step features, enable **Tasks Mode**:
```bash
wigg "Implement the new billing portal" --tasks
```

You can view or inject new tasks into the active loop:
- `--list-tasks`: Display the current structured task list.
- `--add-task "desc"`: Add a new task to the queue.

## Loop Management

`wigg` manages active loop state. If you try to start a new mission while a loop is active, you will be prompted to either discard the current state, continue it, or cancel.

You can also manage the active loop context directly:
- `--status`: Show the current Wigg loop status and history.
- `--add-context TEXT`: Queue additional context/instructions for the next iteration.
- `--clear-context`: Clear any pending context.

