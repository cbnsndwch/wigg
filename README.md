# wigg

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**wigg** is an autonomous AI coding agent written in TypeScript that executes development tasks from Product Requirements Documents (PRDs) using various AI engines. Inspired by [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy), wigg automates your development workflow by reading tasks and executing them one by one with AI assistance.

## Features

- 🤖 **Multiple AI Engines**: Support for Claude Code, OpenCode, Cursor, Codex, Qwen-Code, and Factory Droid
- 📝 **Flexible Task Input**: Read tasks from Markdown PRDs, YAML files, or GitHub Issues
- 🔄 **Two Execution Modes**: Single-task mode or continuous PRD loop
- 🌳 **Git Integration**: Automatic commits, branching, and PR creation
- ⚡ **Parallel Execution**: Run multiple tasks concurrently with isolated workspaces
- 🎯 **Project Rules**: Configure coding standards and boundaries
- 🔁 **Retry Logic**: Automatic retry with configurable delays
- 🎨 **Progress Tracking**: Real-time task execution feedback

## Installation

### From npm (when published)

```bash
npm install -g wigg
```

### From source

```bash
git clone https://github.com/cbnsndwch/wigg.git
cd wigg
npm install
npm run build
npm link
```

## Quick Start

### Single Task Mode

Execute a single task without a PRD:

```bash
wigg "add login button"
wigg "implement dark mode"
wigg "fix authentication bug"
```

### PRD Mode

Create a PRD file (Markdown or YAML) and run wigg:

```bash
# Using default PRD.md
wigg

# Using a specific file
wigg --prd tasks.md
wigg --yaml tasks.yaml
```

**Example PRD.md:**

```markdown
# Project Tasks

## Tasks

- [ ] Add user authentication
- [ ] Create dashboard
- [ ] Implement REST API
- [x] Setup project (already done)
```

**Example tasks.yaml:**

```yaml
tasks:
  - title: Add user authentication
    description: Implement JWT-based auth
    completed: false
    parallel_group: 1
  
  - title: Create dashboard
    completed: false
    parallel_group: 2
```

## Project Configuration

Initialize wigg configuration in your project:

```bash
# Initialize with auto-detected settings
wigg init

# View current configuration
wigg config

# Add project rules
wigg add-rule "use TypeScript strict mode"
wigg add-rule "follow error pattern in src/utils/errors.ts"
```

This creates `.wigg/config.yaml`:

```yaml
project:
  name: "my-app"
  language: "TypeScript"

commands:
  test: "npm test"
  lint: "npm run lint"
  build: "npm run build"

rules:
  - "use TypeScript strict mode"
  - "follow error pattern in src/utils/errors.ts"

boundaries:
  neverTouch:
    - "node_modules/**"
    - "*.lock"
    - "dist/**"
```

## AI Engines

Switch between different AI coding assistants:

```bash
wigg --claude          # Claude Code (default)
wigg --opencode        # OpenCode
wigg --cursor          # Cursor
wigg --codex           # Codex
wigg --qwen            # Qwen-Code
wigg --droid           # Factory Droid
```

Each engine requires its CLI tool to be installed:
- **Claude**: `claude` command
- **OpenCode**: `opencode` command
- **Cursor**: `agent` command
- **Codex**: `codex` command
- **Qwen**: `qwen` command
- **Droid**: `droid` command

## Task Sources

### Markdown Files

```bash
wigg --prd PRD.md
```

Tasks use standard markdown checkbox format:
- `- [ ]` for pending tasks
- `- [x]` for completed tasks (skipped)

### YAML Files

```bash
wigg --yaml tasks.yaml
```

YAML format supports additional metadata:

```yaml
tasks:
  - title: Task name
    description: Detailed description
    completed: false
    parallel_group: 1  # Group for parallel execution
```

### GitHub Issues

```bash
# Fetch all open issues
wigg --github owner/repo

# Filter by label
wigg --github owner/repo --github-label "ready"
```

Requires `GITHUB_TOKEN` environment variable for authentication.

## Git Integration

### Branch Per Task

Create a separate branch for each task:

```bash
wigg --branch-per-task
wigg --branch-per-task --base-branch develop
```

Branch naming format: `wigg/<task-slug>`

### Pull Requests

```bash
# Auto-merge branches
wigg --branch-per-task

# Create PRs instead of merging
wigg --branch-per-task --create-pr

# Create draft PRs
wigg --branch-per-task --draft-pr
```

### Commit Control

```bash
# Disable auto-commit
wigg --no-commit
```

## Parallel Execution

Run multiple tasks concurrently:

```bash
# Default: 3 parallel agents
wigg --parallel

# Custom parallel count
wigg --parallel --max-parallel 5
```

Use `parallel_group` in YAML to control execution order:

```yaml
tasks:
  - title: Task 1
    parallel_group: 1
  - title: Task 2
    parallel_group: 1  # Runs with Task 1
  - title: Task 3
    parallel_group: 2  # Runs after group 1 completes
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--prd <file>` | Path to PRD file | `PRD.md` |
| `--yaml <file>` | Path to YAML task file | - |
| `--github <repo>` | GitHub repository (owner/repo) | - |
| `--github-label <label>` | Filter issues by label | - |
| `--parallel` | Execute tasks in parallel | `false` |
| `--max-parallel <n>` | Maximum parallel agents | `3` |
| `--branch-per-task` | Create branch per task | `false` |
| `--base-branch <branch>` | Base branch for task branches | current |
| `--create-pr` | Create pull requests | `false` |
| `--draft-pr` | Create draft PRs | `false` |
| `--no-tests` | Skip running tests | `false` |
| `--no-lint` | Skip running linter | `false` |
| `--fast` | Skip tests and linting | `false` |
| `--no-commit` | Don't auto-commit changes | `false` |
| `--max-iterations <n>` | Max tasks to execute | all |
| `--max-retries <n>` | Retries per task | `3` |
| `--retry-delay <n>` | Delay between retries (seconds) | `0` |
| `--dry-run` | Preview without executing | `false` |
| `-v, --verbose` | Enable verbose output | `false` |

## Examples

### Basic Usage

```bash
# Single task
wigg "add login form"

# PRD with auto-commit
wigg --prd backlog.md

# Skip tests for speed
wigg --prd tasks.md --fast
```

### Advanced Workflows

```bash
# Parallel execution with branches and PRs
wigg --prd sprint.yaml \
  --parallel \
  --max-parallel 5 \
  --branch-per-task \
  --create-pr

# Custom retry logic
wigg --prd tasks.md \
  --max-retries 5 \
  --retry-delay 10

# Dry run to preview
wigg --prd PRD.md --dry-run

# GitHub issues workflow
wigg --github myorg/myrepo \
  --github-label "sprint-1" \
  --branch-per-task \
  --create-pr
```

### CI/CD Integration

```yaml
# .github/workflows/wigg.yml
name: Automated Development
on:
  workflow_dispatch:
    inputs:
      prd:
        description: 'PRD file to execute'
        required: true
        default: 'PRD.md'

jobs:
  execute-tasks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g wigg
      - run: wigg --prd ${{ github.event.inputs.prd }} --no-commit
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Requirements

**Required:**
- Node.js >= 18
- An AI engine CLI (Claude, OpenCode, Cursor, etc.)

**Optional:**
- Git (for branching and commits)
- GitHub CLI (`gh`) for PR creation
- `GITHUB_TOKEN` for GitHub Issues integration

## Development

```bash
# Clone the repository
git clone https://github.com/cbnsndwch/wigg.git
cd wigg

# Install dependencies
npm install

# Run in development mode
npm run dev -- "your task here"

# Build
npm run build

# Test the CLI
node dist/cli.js --help
```

## Architecture

```
src/
├── cli.ts              # CLI entry point and argument parsing
├── types/              # TypeScript type definitions
├── parsers/            # Task parsers (Markdown, YAML, GitHub)
├── engines/            # AI engine configurations
├── utils/              # Utilities (config, git, logger)
├── commands/           # CLI commands (init, config, add-rule)
└── orchestrator.ts     # Task execution orchestration
```

## Troubleshooting

### AI Engine Not Found

Ensure the AI engine CLI is installed and in your PATH:

```bash
which claude    # or opencode, cursor, etc.
```

### Git Operations Fail

Initialize git in your project:

```bash
git init
git add .
git commit -m "Initial commit"
```

### GitHub API Rate Limits

Set `GITHUB_TOKEN` to increase rate limits:

```bash
export GITHUB_TOKEN=your_token_here
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [michaelshimeles/ralphy](https://github.com/michaelshimeles/ralphy)
- Built with [Commander.js](https://github.com/tj/commander.js), [Chalk](https://github.com/chalk/chalk), and [Simple Git](https://github.com/steveukx/git-js)

## Roadmap

- [ ] Web dashboard for monitoring task execution
- [ ] Cost tracking and budget limits
- [ ] Task dependencies and prerequisites
- [ ] Custom AI personas and skills
- [ ] Conflict resolution strategies
- [ ] Multi-repository support
- [ ] Task scheduling and cron integration
- [ ] Rollback and undo capabilities

---

**Note**: wigg is a pure TypeScript implementation designed for Node.js environments. For shell-based alternatives, see [ralphy](https://github.com/michaelshimeles/ralphy).

