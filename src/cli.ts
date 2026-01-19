#!/usr/bin/env node

import { Command } from 'commander';
import { WiggOptions } from './types';
import { TaskParser } from './parsers/taskParser';
import { GitHubParser } from './parsers/githubParser';
import { TaskOrchestrator } from './orchestrator';
import { InitCommand, ConfigCommand, AddRuleCommand } from './commands/config';
import { Logger } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger();

const program = new Command();

// Read package.json for version
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8')
);

program
  .name('wigg')
  .description('Autonomous AI coding agent - executes tasks from PRDs using AI engines')
  .version(packageJson.version);

// Main execution command (default)
program
  .argument('[task]', 'Single task to execute (if not using --prd)')
  .option('--prd <file>', 'Path to PRD file (Markdown or YAML)', 'PRD.md')
  .option('--yaml <file>', 'Path to YAML task file')
  .option('--github <repo>', 'GitHub repository (owner/repo) to fetch issues from')
  .option('--github-label <label>', 'Filter GitHub issues by label')
  .option('--parallel', 'Execute tasks in parallel')
  .option('--max-parallel <n>', 'Maximum parallel agents', '3')
  .option('--branch-per-task', 'Create a branch for each task')
  .option('--base-branch <branch>', 'Base branch for task branches')
  .option('--create-pr', 'Create pull requests for each task')
  .option('--draft-pr', 'Create draft pull requests')
  .option('--no-tests', 'Skip running tests')
  .option('--no-lint', 'Skip running linter')
  .option('--fast', 'Skip tests and linting')
  .option('--no-commit', 'Do not auto-commit changes')
  .option('--max-iterations <n>', 'Maximum number of tasks to execute')
  .option('--max-retries <n>', 'Maximum retries per task', '3')
  .option('--retry-delay <n>', 'Delay between retries in seconds')
  .option('--dry-run', 'Preview tasks without executing')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--claude', 'Use Claude Code engine (default)')
  .option('--opencode', 'Use OpenCode engine')
  .option('--cursor', 'Use Cursor engine')
  .option('--codex', 'Use Codex engine')
  .option('--qwen', 'Use Qwen-Code engine')
  .option('--droid', 'Use Factory Droid engine')
  .action(async (task, options) => {
    try {
      // Determine AI engine
      let engine: WiggOptions['engine'] = 'claude';
      if (options.opencode) engine = 'opencode';
      if (options.cursor) engine = 'cursor';
      if (options.codex) engine = 'codex';
      if (options.qwen) engine = 'qwen';
      if (options.droid) engine = 'droid';
      
      const wiggOptions: WiggOptions = {
        prd: options.prd,
        yaml: options.yaml,
        github: options.github,
        githubLabel: options.githubLabel,
        parallel: options.parallel,
        maxParallel: options.maxParallel ? parseInt(options.maxParallel) : undefined,
        branchPerTask: options.branchPerTask,
        baseBranch: options.baseBranch,
        createPr: options.createPr,
        draftPr: options.draftPr,
        noTests: options.noTests,
        noLint: options.noLint,
        fast: options.fast,
        noCommit: options.noCommit,
        maxIterations: options.maxIterations ? parseInt(options.maxIterations) : undefined,
        maxRetries: options.maxRetries ? parseInt(options.maxRetries) : undefined,
        retryDelay: options.retryDelay ? parseInt(options.retryDelay) : undefined,
        dryRun: options.dryRun,
        verbose: options.verbose,
        engine,
        task,
      };
      
      // Parse tasks
      let tasks;
      
      if (task) {
        // Single task mode
        logger.info('Single task mode');
        tasks = [TaskParser.createSingleTask(task)];
      } else if (options.github) {
        // GitHub issues mode
        logger.info(`Fetching tasks from GitHub: ${options.github}`);
        const githubParser = new GitHubParser();
        tasks = await githubParser.parseIssues(options.github, options.githubLabel);
      } else {
        // PRD file mode
        const prdPath = options.yaml || options.prd;
        
        if (!fs.existsSync(prdPath)) {
          logger.error(`File not found: ${prdPath}`);
          process.exit(1);
        }
        
        logger.info(`Loading tasks from: ${prdPath}`);
        tasks = TaskParser.parse(prdPath);
      }
      
      logger.info(`Found ${tasks.length} task(s)`);
      
      // Execute tasks
      const orchestrator = new TaskOrchestrator(wiggOptions);
      const results = await orchestrator.executeTasks(tasks);
      
      // Print summary
      orchestrator.printSummary(results);
      
      // Exit with error code if any tasks failed
      const hasFailures = results.some(r => !r.success);
      if (hasFailures) {
        process.exit(1);
      }
    } catch (error) {
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      if (options.verbose && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Init command
program
  .command('init')
  .description('Initialize wigg configuration')
  .action(async () => {
    try {
      await InitCommand.execute();
    } catch (error) {
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    try {
      await ConfigCommand.execute();
    } catch (error) {
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

// Add-rule command
program
  .command('add-rule <rule>')
  .description('Add a rule to the project configuration')
  .action(async (rule: string) => {
    try {
      await AddRuleCommand.execute(rule);
    } catch (error) {
      logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

program.parse();
