# Changesets

Hi! This folder contains changesets — files that describe a change to a package
in this monorepo. Changesets are consumed by [@changesets/cli](https://github.com/changesets/changesets)
to version and publish each package independently.

## Adding a changeset

Run this from the repo root and follow the prompts:

```sh
pnpm changeset
```

This will create a new markdown file in this folder describing the change and
the packages + semver bump it implies. Commit that file alongside your code.

## Consuming changesets

```sh
pnpm version   # apply pending changesets, bump versions, update CHANGELOGs
pnpm release   # build all packages and publish to npm
```

Each package in `packages/*` is published separately so users can install a
single extension via `pi install npm:<package-name>`.
