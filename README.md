# pi-claudian

A monorepo of independently-published [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extensions for collaborating with Claudian.

Each extension lives in its own package under `packages/*` and is published to npm separately, so you can install only what you need:

```
pi install npm:<package-name>
```

## Extensions

| Package                                          | Description                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`@pi-claudian/sync-title`](packages/sync-title) | Sync Claudian conversation titles into pi session names so they appear in `/resume`. |

## Development

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```sh
pnpm install      # install dependencies
pnpm build        # build all packages (tsc -> dist/)
pnpm typecheck    # type-check all packages without emitting
pnpm lint         # check formatting with prettier
pnpm format       # fix formatting with prettier
```

## Releasing

This repo uses [Changesets](https://github.com/changesets/changesets) for independent versioning and publishing of each extension.

```sh
pnpm changeset    # describe a change (creates a changeset file)
pnpm version      # apply changesets -> bump versions, update CHANGELOGs
pnpm release      # build all packages and publish to npm
```

See [`.changeset/README.md`](.changeset/README.md) for details.

## Contributing

Contributions are welcome — bug reports, feature ideas, new extensions, or fixes.
See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

Quick links:

- [Open an issue](https://github.com/licongy/pi-claudian/issues)
- [Start a discussion](https://github.com/licongy/pi-claudian/discussions)
- Look for [`good first issue`](https://github.com/licongy/pi-claudian/labels/good%20first%20issue) / [`help wanted`](https://github.com/licongy/pi-claudian/labels/help%20wanted) labels

New to the codebase? [`packages/sync-title`](packages/sync-title) is a minimal,
up-to-date template to copy when adding an extension.

## License

[MIT](LICENSE)
