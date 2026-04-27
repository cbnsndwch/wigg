# Iteration {{iteration}} / {{maxIterations}}

You are executing a long-running, re-entrant development loop inside the
**{{projectName}}** repository.

## Mission

{{task}}

## Mandatory reads (every iteration, before doing anything else)

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

When the task is fully done, emit exactly this tag on its own line, then stop:

`<promise>{{completionPromise}}</promise>`

{{#if context}}

## Operator hint for this iteration

{{context}}
{{/if}}

{{#if recentHistory}}

## Recent iteration history (use this to avoid redoing or undoing work)

```
{{recentHistory}}
```

{{/if}}
