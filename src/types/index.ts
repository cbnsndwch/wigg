export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  parallelGroup?: number;
  branch?: string;
}

export interface ProjectConfig {
  project: {
    name: string;
    language?: string;
    framework?: string;
  };
  commands?: {
    test?: string;
    lint?: string;
    build?: string;
  };
  rules?: string[];
  boundaries?: {
    neverTouch?: string[];
  };
}

export interface WiggOptions {
  prd?: string;
  yaml?: string;
  github?: string;
  githubLabel?: string;
  parallel?: boolean;
  maxParallel?: number;
  branchPerTask?: boolean;
  baseBranch?: string;
  createPr?: boolean;
  draftPr?: boolean;
  noTests?: boolean;
  noLint?: boolean;
  fast?: boolean;
  noCommit?: boolean;
  maxIterations?: number;
  maxRetries?: number;
  retryDelay?: number;
  dryRun?: boolean;
  verbose?: boolean;
  engine?: AIEngine;
  task?: string; // single task mode
}

export type AIEngine = 
  | 'claude'
  | 'opencode'
  | 'cursor'
  | 'codex'
  | 'qwen'
  | 'droid';

export interface TaskResult {
  task: Task;
  success: boolean;
  error?: string;
  retries: number;
  duration: number;
  output?: string;
}

export interface EngineConfig {
  command: string;
  args: string[];
  parseOutput?: (output: string) => { tokens?: number; cost?: number };
}
