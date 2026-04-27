# Instructions / Notes for using @cbnsndwch/wigg 

When publishing, ALWAYS use:
`pnpm run changeset:publish`

**CRITICAL RULE:** NEVER use `npm publish` directly. This repository uses pnpm's `catalog:` feature for dependencies. `npm publish` does not understand `catalog:` and will publish the package with literal `"catalog:"` versions in `package.json`, completely breaking downstream installations. Only pnpm (`pnpm publish` or `changeset publish` under pnpm) can correctly replace the `catalog:` placeholders with real package versions before uploading to the registry.

*Note: Always use the changeset `publish` command (or `pnpm run changeset:publish`) when publishing releases, rather than manually tagging or running `npm publish` directly, to ensure GitHub releases and tags are created correctly by the changesets CLI.*

Do not use `pnpm run publish` without `changeset` context if it's missing from `scripts`.
