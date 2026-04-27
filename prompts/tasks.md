# Tasks Iteration {{iteration}} / {{maxIterations}}

## Mission

{{task}}

## Task list ({{tasksFile}})

```
{{tasksContent}}
```

{{#if currentTask}}
**Currently in progress:** {{currentTask}}
{{else}}
{{#if nextTask}}
**Next up:** {{nextTask}} — mark it `[/]` in `{{tasksFile}}` when you start, `[x]` when done.
{{/if}}
{{/if}}

## Mandatory reads every iteration

1. `AGENTS.md` or `CLAUDE.md`, whichever is present — project facts, package map, build commands.
2. any instructions files directly linked from `AGENTS.md` or `CLAUDE.md`

## Rules

- This is a **pnpm repo**. Always use `pnpm`, never npm or yarn.
- Formatter: **oxfmt** (single quotes, no trailing commas, 4-space indent).
  Linter: **oxlint**. Run `pnpm lint` / `pnpm format` to verify.
- Commit convention: `type(scope): message` — imperative, < 72 chars.
- Do NOT guess state. Read the relevant files before acting.
- Make the smallest useful unit of progress per iteration.

## Completion protocol

- Finished the current task? Mark it `[x]` in `{{tasksFile}}`, then emit:
  `<promise>{{taskPromise}}</promise>`
- All tasks done? Emit:
  `<promise>{{completionPromise}}</promise>`

{{#if context}}

## Operator hint

{{context}}
{{/if}}

{{#if recentHistory}}

## Recent iteration history

```
{{recentHistory}}
```

{{/if}}
