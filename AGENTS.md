# AGENTS.md

Guidance for agents (and humans) working in this repo.

## Project

Monorepo of independently-published pi extensions for Claudian collaboration.
One publishable package per directory under `packages/*`. Each package builds
its `index.ts` entry to `dist/` with `tsc` and is published to npm so users can
`pi install npm:<package-name>`.

## Commands

Run from the repo root:

- `pnpm install` — install dependencies
- `pnpm build` — build all packages (`tsc` → `dist/`)
- `pnpm typecheck` — type-check all packages (`tsc --noEmit`)
- `pnpm lint` — `prettier --check .`
- `pnpm format` — `prettier --write .`
- `pnpm changeset` — add a changeset describing a change
- `pnpm version` — apply changesets, bump versions, update CHANGELOGs
- `pnpm release` — build all packages and publish to npm

Per-package equivalents exist (e.g. `pnpm --filter @pi-claudian/sync-title build`).

## Conventions

- TypeScript: strict, ESM (`"type": "module"`), `module: NodeNext`,
  `verbatimModuleSyntax`. Type-only imports must use `import type`.
- Shared compiler options live in `tsconfig.base.json`; each package extends it.
- Extension entry is `index.ts` exporting a default factory
  `(pi: ExtensionAPI) => void | Promise<void>`.
- `@earendil-works/pi-coding-agent` is a peer dependency (provided by pi at
  runtime) and a dev dependency (for build-time types). It is imported as
  types only, so it never appears in the published `dist/`.
- Before committing, run `pnpm typecheck` and `pnpm lint`.

## Releases

Uses Changesets. Add a changeset (`pnpm changeset`) for any user-facing change,
then `pnpm version` and `pnpm release`. Each package versions independently.
