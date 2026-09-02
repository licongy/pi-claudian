import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const tagOnly = args.includes("--tag-only");
const requested = args.filter((a) => !a.startsWith("--"))[0];

if (!requested) {
  console.error("usage: pnpm release:one <package-name|package-dir> [--tag-only]");
  console.error(
    "publishes one package (same as `changeset publish` does for it) and creates its git tag.",
  );
  console.error(
    "--tag-only creates the git tag without publishing (use when npm already has the version).",
  );
  process.exit(1);
}

const packagesDir = path.join(repoRoot, "packages");
const packages = fs
  .readdirSync(packagesDir)
  .map((dir) => {
    const jsonPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(jsonPath)) return null;
    const packageJson = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    return { dir: path.join(packagesDir, dir), packageJson };
  })
  .filter(Boolean);

const pkg =
  packages.find((p) => p.packageJson.name === requested) ??
  packages.find((p) => path.basename(p.dir) === requested);

if (!pkg) {
  console.error(`no package matches "${requested}".`);
  console.error(`available: ${packages.map((p) => p.packageJson.name).join(", ")}`);
  process.exit(1);
}

if (pkg.packageJson.private) {
  console.error(`${pkg.packageJson.name} is private and cannot be published.`);
  process.exit(1);
}

const name = pkg.packageJson.name;
const version = pkg.packageJson.version;
const tag = `${name}@${version}`;

const run = (command, argv, opts = {}) =>
  spawnSync(command, argv, { stdio: "pipe", encoding: "utf8", ...opts });

const gitTags = run("git", ["tag"], { cwd: repoRoot });
if (gitTags.stdout.split("\n").includes(tag)) {
  console.log(`${tag}: tag already exists, nothing to do.`);
  process.exit(0);
}

const clean = spawnSync("node", [path.join(repoRoot, "scripts", "check-clean.mjs")], {
  stdio: "inherit",
});
if (clean.status !== 0) process.exit(1);

if (!tagOnly) {
  console.log(`publishing ${name}@${version}...`);
  const publish = spawnSync("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
    cwd: pkg.dir,
    stdio: "inherit",
  });
  if (publish.status !== 0) {
    console.error("");
    console.error(`publishing ${name}@${version} failed.`);
    console.error("no git tag was created. log in to npm and re-run this command,");
    console.error("or, if npm already has this version, re-run with --tag-only.");
    process.exit(1);
  }
}

console.log(`creating git tag ${tag}...`);
const gitTag = run("git", ["tag", tag, "-m", tag], { cwd: repoRoot });
if (gitTag.status !== 0) {
  console.error(`failed to create git tag ${tag}:`);
  console.error(gitTag.stderr);
  process.exit(1);
}

console.log("");
console.log(`done: ${name}@${version} published and tagged as ${tag}.`);
console.log(`push the tag with: git push origin ${tag}`);
