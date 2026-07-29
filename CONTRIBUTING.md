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
pnpm build
```

Verify your environment:

```sh
pnpm typecheck   # tsc --noEmit across all packages
pnpm lint        # prettier --check .
pnpm format      # prettier --write . (fix formatting)
```

## Project layout

- One publishable extension per directory under `packages/*`.
- Each package builds its `index.ts` to `dist/` with `tsc` and is published to
  npm so users can `pi install npm:<package-name>`.
- Shared TypeScript config lives in `tsconfig.base.json`; each package extends it.
- `@earendil-works/pi-coding-agent` is a peer dependency (types only) — never
  bundle it into a package's `dist/`.

See [AGENTS.md](AGENTS.md) for the full conventions.

## Adding a new extension

1. Create `packages/<name>/` with an `index.ts` exporting a default factory
   `(pi: ExtensionAPI) => void | Promise<void>`.
2. Copy the structure from an existing package (`packages/sync-title/` is a good
   template): `package.json`, `tsconfig.json`, `README.md`.
3. In `package.json`, include the `pi-package` keyword and a `pi` manifest so pi
   can load the extension and pi.dev/packages can discover it:

   ```json
   {
     "keywords": ["pi-package", "pi-extension"],
     "pi": { "extensions": ["./dist/index.js"] }
   }
   ```

4. Add it to the Extensions table in the root `README.md`.

## Making changes

- Keep a change focused — one feature or fix per pull request.
- Follow the existing code style (enforced by Prettier). Run `pnpm format`.
- Don't add comments unless they explain non-obvious intent.
- Before opening a PR, ensure `pnpm typecheck` and `pnpm lint` pass.

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
