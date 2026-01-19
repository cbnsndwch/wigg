import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';

export class GitManager {
  private git: SimpleGit;
  
  constructor(private workingDir: string = process.cwd()) {
    this.git = simpleGit(workingDir);
  }
  
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }
  
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }
  
  async createBranch(branchName: string, baseBranch?: string): Promise<void> {
    if (baseBranch) {
      await this.git.checkout(baseBranch);
    }
    
    await this.git.checkoutLocalBranch(branchName);
  }
  
  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }
  
  async commit(message: string): Promise<void> {
    await this.git.add('.');
    await this.git.commit(message);
  }
  
  async push(branch?: string, force?: boolean): Promise<void> {
    const currentBranch = branch || await this.getCurrentBranch();
    const options = force ? ['--force'] : [];
    await this.git.push('origin', currentBranch, options);
  }
  
  async hasChanges(): Promise<boolean> {
    const status = await this.git.status();
    return status.files.length > 0;
  }
  
  async merge(branch: string): Promise<void> {
    await this.git.merge([branch]);
  }
  
  async branchExists(branchName: string): Promise<boolean> {
    try {
      const branches = await this.git.branch();
      return branches.all.includes(branchName);
    } catch {
      return false;
    }
  }
  
  slugifyBranch(taskTitle: string): string {
    return taskTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }
}
