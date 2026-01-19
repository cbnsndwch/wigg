import { spawn } from 'child_process';
import { Task, TaskResult, AIEngine, ProjectConfig } from '../types';
import { getEngineConfig } from './config';
import { Logger } from '../utils/logger';
import { GitManager } from '../utils/git';

export class TaskExecutor {
  constructor(
    private engine: AIEngine,
    private logger: Logger,
    private gitManager: GitManager,
    private config?: ProjectConfig
  ) {}
  
  async executeTask(
    task: Task,
    options: {
      noTests?: boolean;
      noLint?: boolean;
      noCommit?: boolean;
      maxRetries?: number;
      retryDelay?: number;
    } = {}
  ): Promise<TaskResult> {
    const startTime = Date.now();
    const maxRetries = options.maxRetries || 3;
    let retries = 0;
    let lastError: string | undefined;
    
    while (retries < maxRetries) {
      try {
        this.logger.task(`Executing: ${task.title}`);
        
        // Build the prompt for the AI engine
        const prompt = this.buildPrompt(task);
        
        // Execute the AI engine
        const output = await this.runEngine(prompt);
        
        // Run tests if configured and not skipped
        if (!options.noTests && this.config?.commands?.test) {
          this.logger.debug('Running tests...');
          await this.runCommand(this.config.commands.test);
        }
        
        // Run linter if configured and not skipped
        if (!options.noLint && this.config?.commands?.lint) {
          this.logger.debug('Running linter...');
          await this.runCommand(this.config.commands.lint);
        }
        
        // Commit changes if not skipped
        if (!options.noCommit && await this.gitManager.hasChanges()) {
          this.logger.debug('Committing changes...');
          await this.gitManager.commit(`feat: ${task.title}`);
        }
        
        const duration = Date.now() - startTime;
        this.logger.success(`Task completed in ${(duration / 1000).toFixed(2)}s`);
        
        return {
          task,
          success: true,
          retries,
          duration,
          output,
        };
      } catch (error) {
        retries++;
        lastError = error instanceof Error ? error.message : String(error);
        
        if (retries < maxRetries) {
          this.logger.warning(`Task failed (attempt ${retries}/${maxRetries}), retrying...`);
          
          if (options.retryDelay) {
            await this.delay(options.retryDelay * 1000);
          }
        }
      }
    }
    
    const duration = Date.now() - startTime;
    this.logger.error(`Task failed after ${maxRetries} attempts`);
    
    return {
      task,
      success: false,
      error: lastError,
      retries,
      duration,
    };
  }
  
  private buildPrompt(task: Task): string {
    let prompt = task.title;
    
    if (task.description) {
      prompt += `\n\n${task.description}`;
    }
    
    if (this.config?.rules && this.config.rules.length > 0) {
      prompt += '\n\nProject Rules:\n';
      for (const rule of this.config.rules) {
        prompt += `- ${rule}\n`;
      }
    }
    
    if (this.config?.boundaries?.neverTouch && this.config.boundaries.neverTouch.length > 0) {
      prompt += '\n\nNever modify:\n';
      for (const pattern of this.config.boundaries.neverTouch) {
        prompt += `- ${pattern}\n`;
      }
    }
    
    return prompt;
  }
  
  private async runEngine(prompt: string): Promise<string> {
    const engineConfig = getEngineConfig(this.engine);
    
    return new Promise((resolve, reject) => {
      const args = [...engineConfig.args, prompt];
      const child = spawn(engineConfig.command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });
      
      child.stderr?.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Engine exited with code ${code}: ${stderr}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  private async runCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        shell: true,
        stdio: 'inherit',
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });
      
      child.on('error', (error) => {
        reject(error);
      });
    });
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
