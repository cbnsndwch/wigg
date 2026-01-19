# wigg - Testing Instructions

## Manual Testing Guide

Since wigg integrates with external AI engines (Claude, OpenCode, Cursor, etc.), full end-to-end testing requires having one of these engines installed. Here's how to test wigg:

### 1. Basic CLI Tests (Already Verified ✓)

These tests work without AI engines:

```bash
# Help and version
wigg --help
wigg --version

# Config commands
wigg init
wigg config
wigg add-rule "use TypeScript strict mode"

# Dry-run mode (no AI engine needed)
wigg "add feature" --dry-run
wigg --prd PRD.example.md --dry-run
wigg --yaml tasks.example.yaml --dry-run
```

### 2. With AI Engine (Manual Testing)

To test actual task execution, install an AI engine:

#### Option A: Claude Code

```bash
# Install Claude CLI
npm install -g @anthropics/claude-cli

# Set API key
export ANTHROPIC_API_KEY=your_key_here

# Run a simple task
wigg "add a hello.txt file with Hello World"
```

#### Option B: Mock Engine for Testing

Create a mock AI engine for testing:

```bash
# Create a mock claude script
cat > /usr/local/bin/claude << 'EOF'
#!/bin/bash
echo "Mock AI: Executing task: $@"
echo "Creating requested changes..."
sleep 2
echo "Task completed successfully"
exit 0
EOF

chmod +x /usr/local/bin/claude

# Now test wigg
wigg "add a README section" --no-commit
```

### 3. Git Integration Tests

```bash
# Initialize a test git repo
mkdir /tmp/wigg-test
cd /tmp/wigg-test
git init
echo "# Test Project" > README.md
git add .
git commit -m "Initial commit"

# Test with wigg
wigg "add a new feature" --branch-per-task --dry-run
```

### 4. Parallel Execution Test

```bash
wigg --yaml tasks.example.yaml --parallel --max-parallel 2 --dry-run
```

### 5. GitHub Integration Test

```bash
# Requires GITHUB_TOKEN
export GITHUB_TOKEN=your_token

wigg --github owner/repo --github-label "bug" --dry-run
```

## Test Results Summary

✅ CLI argument parsing
✅ Help and version commands
✅ Configuration initialization (wigg init)
✅ Configuration viewing (wigg config)
✅ Rule management (wigg add-rule)
✅ Markdown PRD parsing
✅ YAML task parsing
✅ Single task mode
✅ Dry-run mode
✅ Max iterations limiting
✅ TypeScript compilation
✅ Package structure

⏳ Requires AI engine:
- Actual task execution
- Git commit integration
- Branch creation and merging
- Parallel task execution
- GitHub PR creation

## Known Limitations

1. **AI Engine Dependency**: wigg requires an external AI CLI tool (Claude, OpenCode, etc.) to be installed
2. **GitHub PR Creation**: Requires GitHub CLI (`gh`) to be installed and authenticated
3. **Worktree Support**: Parallel execution with worktrees is simplified in the current implementation

## Next Steps for Production Use

1. Install your preferred AI engine CLI
2. Configure API keys/authentication
3. Test on a sample project
4. Adjust `.wigg/config.yaml` for your project needs
5. Create PRD files for your tasks
6. Run wigg!
