# Contributing to wigg

Thank you for your interest in contributing to wigg! This document provides guidelines and instructions for contributing.

## Getting Started

1. **Fork the repository**
   ```bash
   git clone https://github.com/yourusername/wigg.git
   cd wigg
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Test your changes**
   ```bash
   npm run dev -- --help
   npm run dev -- "test task" --dry-run
   ```

## Development Workflow

### Project Structure

```
wigg/
├── src/
│   ├── cli.ts              # Main CLI entry point
│   ├── orchestrator.ts     # Task execution orchestration
│   ├── types/              # TypeScript type definitions
│   ├── parsers/            # Task file parsers
│   │   ├── taskParser.ts   # Markdown/YAML parser
│   │   └── githubParser.ts # GitHub Issues parser
│   ├── engines/            # AI engine configurations
│   │   ├── config.ts       # Engine settings
│   │   └── executor.ts     # Task execution
│   ├── utils/              # Utility functions
│   │   ├── config.ts       # Configuration management
│   │   ├── git.ts          # Git operations
│   │   └── logger.ts       # Logging utilities
│   └── commands/           # CLI commands
│       └── config.ts       # Config-related commands
├── dist/                   # Compiled JavaScript (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow TypeScript best practices
   - Use strict type checking
   - Add comments for complex logic
   - Update documentation if needed

3. **Test your changes**
   ```bash
   npm run build
   npm run dev -- "test" --dry-run
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

5. **Push and create a PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Style

- Use TypeScript strict mode
- Follow existing code formatting
- Use meaningful variable and function names
- Keep functions small and focused
- Add JSDoc comments for public APIs

### Example

```typescript
/**
 * Parse tasks from a Markdown file
 * @param filePath - Path to the Markdown file
 * @returns Array of parsed tasks
 */
export function parseMarkdown(filePath: string): Task[] {
  // Implementation
}
```

## Adding New Features

### Adding a New AI Engine

1. Add engine type to `src/types/index.ts`:
   ```typescript
   export type AIEngine = 
     | 'claude'
     | 'opencode'
     | 'your-engine';
   ```

2. Add engine config to `src/engines/config.ts`:
   ```typescript
   'your-engine': {
     command: 'your-cli-command',
     args: ['--flags'],
     parseOutput: (output: string) => {
       // Parse engine-specific output
       return { tokens, cost };
     },
   }
   ```

3. Add CLI option to `src/cli.ts`:
   ```typescript
   .option('--your-engine', 'Use Your Engine')
   ```

### Adding a New Task Source

1. Create parser in `src/parsers/`:
   ```typescript
   export class YourParser {
     static async parse(): Promise<Task[]> {
       // Implementation
     }
   }
   ```

2. Add to CLI in `src/cli.ts`:
   ```typescript
   .option('--your-source <arg>', 'Description')
   ```

3. Add parsing logic:
   ```typescript
   if (options.yourSource) {
     tasks = await YourParser.parse(options.yourSource);
   }
   ```

## Testing

Currently, wigg uses manual testing due to AI engine dependencies. When adding new features:

1. Test with `--dry-run` flag
2. Test with various input formats
3. Test error handling
4. Document test cases in PR

Future: We plan to add automated tests with mocked AI engines.

## Documentation

- Update README.md for user-facing changes
- Update TESTING.md for testing procedures
- Add inline comments for complex logic
- Update examples if needed

## Pull Request Process

1. **Ensure your code builds**
   ```bash
   npm run build
   ```

2. **Update documentation**
   - README.md if user-facing changes
   - Inline code comments
   - CHANGELOG.md (if exists)

3. **Write a clear PR description**
   - What changes were made
   - Why the changes were needed
   - How to test the changes
   - Any breaking changes

4. **Link related issues**
   - Use "Fixes #123" or "Closes #123"

5. **Wait for review**
   - Address feedback promptly
   - Keep discussions constructive

## Feature Requests

- Open an issue with the "enhancement" label
- Describe the feature and use case
- Discuss implementation approach
- Wait for maintainer approval before starting

## Bug Reports

Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- wigg version (`wigg --version`)
- Node.js version (`node --version`)
- AI engine and version
- Relevant configuration

## Questions?

- Open a discussion on GitHub
- Check existing issues and documentation
- Be respectful and patient

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Assume good intentions
- Follow GitHub's Community Guidelines

Thank you for contributing to wigg! 🎉
