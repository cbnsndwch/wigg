import { Octokit } from '@octokit/rest';
import { Task } from '../types';

export class GitHubParser {
  private octokit: Octokit;
  
  constructor() {
    const token = process.env.GITHUB_TOKEN;
    this.octokit = new Octokit({ auth: token });
  }
  
  async parseIssues(repo: string, label?: string): Promise<Task[]> {
    // Validate repo format: must be exactly "owner/repo"
    const parts = repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error('Invalid GitHub repository format. Use: owner/repo');
    }
    
    const [owner, repoName] = parts;
    
    try {
      const { data: issues } = await this.octokit.issues.listForRepo({
        owner,
        repo: repoName,
        state: 'open',
        labels: label ? label : undefined,
      });
      
      return issues
        .filter(issue => !issue.pull_request) // Exclude PRs
        .map((issue, index) => ({
          id: `issue-${issue.number}`,
          title: issue.title,
          description: issue.body || undefined,
          completed: false,
        }));
    } catch (error) {
      throw new Error(`Failed to fetch GitHub issues: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
