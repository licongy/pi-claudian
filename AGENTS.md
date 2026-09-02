# AGENTS.md

Guidance for agents (and humans) working in this repo.

## Project

Monorepo of independently-published Pi extensions for Claudian collaboration.
One publishable package per directory under `packages/*`. Each package publishes
its `index.ts` **source** to npm (Pi loads it via jiti, no compile step) so users
can `pi install npm:<package-name>`.

## Commands

Run from the repo root:

- `pnpm install` — install dependencies
- `pnpm typecheck` — type-check all packages (`tsc --noEmit`)
- `pnpm lint` — `prettier --check .`
- `pnpm format` — `prettier --write .`
- `pnpm run changeset` — add a changeset describing a change
- `pnpm run version` — apply changesets, bump versions, update CHANGELOGs
  (always with `run`: bare `pnpm version` is pnpm's built-in version command,
  which shadows this script and never consumes changesets)
- `pnpm run release` — publish all changed packages to npm
- `pnpm run release:one <package-name|package-dir>` — publish a single package and
  create its git tag (use when publishing everything at once fails, e.g. npm
  login issues; `--tag-only` tags without publishing, for when npm already has
  the version)

Per-package equivalents exist (e.g. `pnpm --filter @pi-claudian/sync-title typecheck`).

## Investigation discipline (open-ended diagnosis/research tasks)

These rules apply to any goal-directed information-seeking work — debugging,
forensics, research, analysis, option evaluation, planning. For breadth
tasks (surveys, codebase orientation) state the deliverable and depth instead
of a single decisive question, and converge on that. They do NOT apply to
routine edits with a clear scope: implementation legitimately requires
reading broadly. The implementation-side analog of the same failure is scope
creep — gold-plating, refactoring beyond the ask, endless self-verification:
deliver what was asked, then stop.

- **Declare the decisive question before investigating.** State in one or
  two sentences: what question must be answered, and what evidence would
  settle it. Investigate only toward that. If a task has no single decisive
  question, say so and propose one before starting.
- **Per-call relevance gate**: before any search or read, it must be able to
  change the answer or the recommended action. Narrative completeness,
  curiosity, attribution of side facts, and "closing every loose end" are not
  reasons. Record unresolved side questions in the final answer as
  "unverified" or "inferred" instead of investigating them.
- **Deliver when the decisive question is answered.** Stop there. Budget is
  a magnitude check only (~25 tool calls): once clearly past it, stop and
  report conclusion, evidence, and unknowns, then ask whether to continue.
- **Checkpoint while working**: restate the current hypothesis and what
  remains to be proven at each step, so the user can redirect or stop early.

## Conventions

- TypeScript: strict, ESM (`"type": "module"`), `module: NodeNext`,
  `verbatimModuleSyntax`. Type-only imports must use `import type`.
- Shared compiler options live in `tsconfig.base.json` (`noEmit`); each package
  extends it. `tsc` is used only for type-checking, not for emitting `dist/`.
- Extension entry is `index.ts` exporting a default factory
  `(pi: ExtensionAPI) => void | Promise<void>`.
- `pi.extensions` manifest points at the `.ts` source; Pi loads it via jiti.
- `@earendil-works/pi-coding-agent` is a peer dependency (provided by Pi at
  runtime) and a dev dependency (for type-checking). It is imported as types
  only, so it never appears in published files.
- Debug logging: every package vendors a `debug.ts` that prints to stderr when
  `PI_CLAUDIAN_DEBUG` is set to an enabling value (anything except empty, `0`,
  `false`, `no`, `off`). See `packages/sync-title/debug.ts` for the pattern.
- Before committing, run `pnpm typecheck` and `pnpm lint`.

## Releases

Uses Changesets. Add a changeset (`pnpm run changeset`) for any user-facing
change, then `pnpm run version` and `pnpm run release`. Each package versions
independently.

Both `pnpm run version` and `pnpm run release` run `scripts/check-clean.mjs`
and abort on a dirty working tree: `pnpm run version` forces committing
source + the changeset before bumping, and `pnpm run release` forces
committing the version bump before publishing so the release's git tag
points at the published code.
