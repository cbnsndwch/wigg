# Instructions / Notes for using @cbnsndwch/wigg 

When publishing, prefer:
`pnpm run changeset:publish`

*Note: Always use the changeset `publish` command (or `pnpm run changeset:publish`) when publishing releases, rather than manually tagging or running `npm publish` directly, to ensure GitHub releases and tags are created correctly by the changesets CLI.*

Do not use `pnpm run publish` without `changeset` context if it's missing from `scripts`.
