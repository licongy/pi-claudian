# Contributing to pi-claudian

Thanks for your interest in improving pi-claudian! Contributions — bug reports,
feature ideas, new extensions, docs, or fixes — are all welcome.

## Quick start

Requires Node.js 20+ and [pnpm](https://pnpm.io) (the repo pins `pnpm@11.15.1`
via corepack).

```sh
git clone https://github.com/licongy/pi-claudian.git
cd pi-claudian
pnpm install
pnpm typecheck
```

Verify your environment:

```sh
pnpm typecheck   # tsc --noEmit across all packages
pnpm lint        # prettier --check .
pnpm format      # prettier --write . (fix formatting)
```

## Project layout

- One publishable extension per directory under `packages/*`.
- Each package publishes its `index.ts` **source** to npm; pi loads it via
  [jiti](https://github.com/unjs/jiti), so there is no build or `dist/` step.
- Shared TypeScript config lives in `tsconfig.base.json` (`noEmit`); each package
  extends it. `tsc` is used only for type-checking.
- `@earendil-works/pi-coding-agent` is a peer dependency (types only) — never
  bundle it into a package's published files.

See [AGENTS.md](AGENTS.md) for the full conventions.

## Adding a new extension

1. Create `packages/<name>/` with an `index.ts` exporting a default factory
   `(pi: ExtensionAPI) => void | Promise<void>`.
2. Copy the structure from an existing package (`packages/sync-title/` is a good
   template): `package.json`, `tsconfig.json`, `README.md`, and a `debug.ts`
   helper.
3. In `package.json`, point the `pi` manifest at the `.ts` source, include the
   `pi-package` keyword, and list the source files (no `dist/`):

   ```json
   {
     "keywords": ["pi-package", "pi-extension"],
     "pi": { "extensions": ["./index.ts"] },
     "files": ["index.ts", "debug.ts", "README.md"]
   }
   ```

4. Add it to the Extensions table in the root `README.md`.

## Making changes

- Keep a change focused — one feature or fix per pull request.
- Follow the existing code style (enforced by Prettier). Run `pnpm format`.
- Don't add comments unless they explain non-obvious intent.
- For diagnostic output, use the `debug.ts` helper (gated on `PI_CLAUDIAN_DEBUG`)
  rather than raw `console.log`.
- Before opening a PR, ensure `pnpm typecheck` and `pnpm lint` pass.

## Debugging

Enable debug logging for all `@pi-claudian` extensions with one environment
variable (output goes to stderr so it never mixes with pi's stdout):

```sh
PI_CLAUDIAN_DEBUG=1 pi              # show debug output inline
PI_CLAUDIAN_DEBUG=1 pi 2>debug.log  # capture to a file
```

## Releases

Releases are managed with [Changesets](https://github.com/changesets/changesets).
For any user-facing change, add a changeset from the repo root:

```sh
pnpm changeset
```

Commit the generated changeset file alongside your code. A maintainer will run
`pnpm version` and `pnpm release` to publish. You do **not** need to publish
yourself.

## Reporting bugs & requesting features

Open a [GitHub Issue](https://github.com/licongy/pi-claudian/issues) and choose
the Bug report or Feature request template. The more reproducible, the better.

## Finding something to work on

Look for issues labeled
[`good first issue`](https://github.com/licongy/pi-claudian/labels/good%20first%20issue)
or
[`help wanted`](https://github.com/licongy/pi-claudian/labels/help%20wanted).
If you have an idea for a new extension, open an issue first to discuss scope.

## Questions & discussion

For open-ended questions or ideas, start a
[GitHub Discussion](https://github.com/licongy/pi-claudian/discussions).

## Code of Conduct

Be kind and constructive. We follow the
[Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/)
in spirit. Unacceptable behavior will not be tolerated.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
