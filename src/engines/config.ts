import { AIEngine, EngineConfig } from '../types';

export const ENGINE_CONFIGS: Record<AIEngine, EngineConfig> = {
  claude: {
    command: 'claude',
    // Note: --dangerously-skip-permissions bypasses permission prompts.
    // Only use in trusted environments. For production, consider removing this flag.
    args: ['--dangerously-skip-permissions'],
    parseOutput: (output: string) => {
      const tokensMatch = output.match(/(\d+)\s+tokens/i);
      const costMatch = output.match(/\$?([\d.]+)/);
      return {
        tokens: tokensMatch ? parseInt(tokensMatch[1]) : undefined,
        cost: costMatch ? parseFloat(costMatch[1]) : undefined,
      };
    },
  },
  opencode: {
    command: 'opencode',
    args: ['full-auto'],
    parseOutput: (output: string) => {
      const tokensMatch = output.match(/(\d+)\s+tokens/i);
      const costMatch = output.match(/\$?([\d.]+)/);
      return {
        tokens: tokensMatch ? parseInt(tokensMatch[1]) : undefined,
        cost: costMatch ? parseFloat(costMatch[1]) : undefined,
      };
    },
  },
  cursor: {
    command: 'agent',
    args: ['--force'],
  },
  codex: {
    command: 'codex',
    args: [],
    parseOutput: (output: string) => {
      const tokensMatch = output.match(/(\d+)\s+tokens/i);
      return {
        tokens: tokensMatch ? parseInt(tokensMatch[1]) : undefined,
      };
    },
  },
  qwen: {
    command: 'qwen',
    // Note: 'yolo' approval mode bypasses confirmation prompts.
    // Consider using a more conservative mode in production environments.
    args: ['--approval-mode', 'yolo'],
    parseOutput: (output: string) => {
      const tokensMatch = output.match(/(\d+)\s+tokens/i);
      return {
        tokens: tokensMatch ? parseInt(tokensMatch[1]) : undefined,
      };
    },
  },
  droid: {
    command: 'droid',
    args: ['exec', '--auto', 'medium'],
  },
};

export function getEngineConfig(engine: AIEngine): EngineConfig {
  return ENGINE_CONFIGS[engine];
}
