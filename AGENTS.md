# AGENTS.md

Guidance for agents (and humans) working in this repo.

## Project

Monorepo of independently-published pi extensions for Claudian collaboration.
One publishable package per directory under `packages/*`. Each package publishes
its `index.ts` **source** to npm (pi loads it via jiti, no compile step) so users
can `pi install npm:<package-name>`.

## Commands

Run from the repo root:

- `pnpm install` — install dependencies
- `pnpm typecheck` — type-check all packages (`tsc --noEmit`)
- `pnpm lint` — `prettier --check .`
- `pnpm format` — `prettier --write .`
- `pnpm changeset` — add a changeset describing a change
- `pnpm version` — apply changesets, bump versions, update CHANGELOGs
- `pnpm release` — publish all changed packages to npm

Per-package equivalents exist (e.g. `pnpm --filter @pi-claudian/sync-title typecheck`).

## Conventions

- TypeScript: strict, ESM (`"type": "module"`), `module: NodeNext`,
  `verbatimModuleSyntax`. Type-only imports must use `import type`.
- Shared compiler options live in `tsconfig.base.json` (`noEmit`); each package
  extends it. `tsc` is used only for type-checking, not for emitting `dist/`.
- Extension entry is `index.ts` exporting a default factory
  `(pi: ExtensionAPI) => void | Promise<void>`.
- `pi.extensions` manifest points at the `.ts` source; pi loads it via jiti.
- `@earendil-works/pi-coding-agent` is a peer dependency (provided by pi at
  runtime) and a dev dependency (for type-checking). It is imported as types
  only, so it never appears in published files.
- Debug logging: every package vendors a `debug.ts` that prints to stderr when
  `PI_CLAUDIAN_DEBUG` is set. See `packages/sync-title/debug.ts` for the pattern.
- Before committing, run `pnpm typecheck` and `pnpm lint`.

## Releases

Uses Changesets. Add a changeset (`pnpm changeset`) for any user-facing change,
then `pnpm version` and `pnpm release`. Each package versions independently.
