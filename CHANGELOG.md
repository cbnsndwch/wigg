# @cbnsndwch/wigg

## 26.427.1

### Patch Changes

- Fix published package containing unresolved `catalog:` protocols in its `package.json` dependencies. We must enforce publishing via `pnpm publish` (via changesets) instead of `npm publish`, so that pnpm correctly replaces `catalog:` values with real package versions before uploading to the registry.

## 26.427.0

### Minor Changes

- Add colored console output for improved terminal readability and better streaming visualization.

## 26.426.4

### Patch Changes

- 79569d4: Fix binary wrapper configuration to properly support cross-platform execution and avoid pnpm link warnings.

## 26.426.2

### Patch Changes

- fd4b344: initial release
