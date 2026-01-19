import { Task, TaskResult, WiggOptions, ProjectConfig } from './types';
import { TaskExecutor } from './engines/executor';
import { Logger } from './utils/logger';
import { GitManager } from './utils/git';
import { ConfigManager } from './utils/config';

export class TaskOrchestrator {
  private logger: Logger;
  private gitManager: GitManager;
  private configManager: ConfigManager;
  private config?: ProjectConfig;
  
  constructor(private options: WiggOptions) {
    this.logger = new Logger(options.verbose);
    this.gitManager = new GitManager();
    this.configManager = new ConfigManager();
    this.config = this.configManager.load() || undefined;
  }
  
  async executeTasks(tasks: Task[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    
    // Filter out completed tasks
    const pendingTasks = tasks.filter(t => !t.completed);
    
    if (pendingTasks.length === 0) {
      this.logger.info('No pending tasks to execute');
      return results;
    }
    
    this.logger.section(`Executing ${pendingTasks.length} task(s)`);
    
    // Check if git repo
    const isGitRepo = await this.gitManager.isGitRepo();
    if (!isGitRepo && !this.options.noCommit) {
      this.logger.warning('Not a git repository. Changes will not be committed.');
    }
    
    // Apply max iterations limit
    const tasksToExecute = this.options.maxIterations
      ? pendingTasks.slice(0, this.options.maxIterations)
      : pendingTasks;
    
    if (this.options.dryRun) {
      this.logger.info('DRY RUN - Tasks that would be executed:');
      for (const task of tasksToExecute) {
        this.logger.info(`  - ${task.title}`);
      }
      return results;
    }
    
    // Group tasks by parallel group if parallel execution is enabled
    if (this.options.parallel) {
      return this.executeParallel(tasksToExecute);
    } else {
      return this.executeSequential(tasksToExecute);
    }
  }
  
  private async executeSequential(tasks: Task[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    const baseBranch = this.options.baseBranch || await this.gitManager.getCurrentBranch();
    
    for (const task of tasks) {
      // Create branch per task if enabled
      if (this.options.branchPerTask) {
        const branchName = `wigg/${this.gitManager.slugifyBranch(task.title)}`;
        task.branch = branchName;
        
        this.logger.debug(`Creating branch: ${branchName}`);
        await this.gitManager.createBranch(branchName, baseBranch);
      }
      
      const executor = new TaskExecutor(
        this.options.engine || 'claude',
        this.logger,
        this.gitManager,
        this.config
      );
      
      const result = await executor.executeTask(task, {
        noTests: this.options.noTests || this.options.fast,
        noLint: this.options.noLint || this.options.fast,
        noCommit: this.options.noCommit,
        maxRetries: this.options.maxRetries,
        retryDelay: this.options.retryDelay,
      });
      
      results.push(result);
      
      // If branch per task and task succeeded, handle merge or PR
      if (this.options.branchPerTask && result.success) {
        if (this.options.createPr) {
          this.logger.info(`Branch ${task.branch} ready for PR`);
          // PR creation would require GitHub integration
        } else {
          // Merge back to base branch
          this.logger.debug(`Merging ${task.branch} to ${baseBranch}`);
          await this.gitManager.checkout(baseBranch);
          await this.gitManager.merge(task.branch!);
        }
      }
      
      // Stop if task failed and we're not continuing
      if (!result.success) {
        this.logger.error(`Stopping due to task failure: ${task.title}`);
        break;
      }
    }
    
    return results;
  }
  
  private async executeParallel(tasks: Task[]): Promise<TaskResult[]> {
    const maxParallel = this.options.maxParallel || 3;
    
    // Group tasks by parallel group
    const groups = this.groupTasksByParallelGroup(tasks);
    const results: TaskResult[] = [];
    
    for (const group of groups) {
      this.logger.section(`Executing parallel group with ${group.length} task(s)`);
      
      // Execute tasks in batches
      for (let i = 0; i < group.length; i += maxParallel) {
        const batch = group.slice(i, i + maxParallel);
        
        const batchPromises = batch.map(async (task) => {
          // For parallel execution, each task would need its own worktree
          // This is a simplified version - full implementation would use git worktree
          const executor = new TaskExecutor(
            this.options.engine || 'claude',
            this.logger,
            this.gitManager,
            this.config
          );
          
          return executor.executeTask(task, {
            noTests: this.options.noTests || this.options.fast,
            noLint: this.options.noLint || this.options.fast,
            noCommit: this.options.noCommit,
            maxRetries: this.options.maxRetries,
            retryDelay: this.options.retryDelay,
          });
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }
    }
    
    return results;
  }
  
  private groupTasksByParallelGroup(tasks: Task[]): Task[][] {
    const groups = new Map<number, Task[]>();
    
    for (const task of tasks) {
      const group = task.parallelGroup || 0;
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(task);
    }
    
    // Sort by group number
    return Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, tasks]) => tasks);
  }
  
  printSummary(results: TaskResult[]): void {
    this.logger.section('Summary');
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    this.logger.info(`Total tasks: ${results.length}`);
    this.logger.success(`Successful: ${successful}`);
    
    if (failed > 0) {
      this.logger.error(`Failed: ${failed}`);
      
      this.logger.section('Failed Tasks');
      for (const result of results.filter(r => !r.success)) {
        this.logger.error(`- ${result.task.title}`);
        if (result.error) {
          this.logger.debug(`  ${result.error}`);
        }
      }
    }
    
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    this.logger.info(`Total duration: ${(totalDuration / 1000).toFixed(2)}s`);
  }
}
