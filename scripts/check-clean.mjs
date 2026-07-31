import { execSync } from "node:child_process";

let status;
try {
  status = execSync("git status --porcelain", { encoding: "utf-8" });
} catch {
  console.error("could not run `git status` — is this a git repository?");
  process.exit(1);
}

if (status.trim() === "") {
  process.exit(0);
}

console.error("working tree is not clean. commit or stash changes first:");
console.error("");
for (const line of status.split("\n")) {
  if (line) console.error("  " + line);
}
console.error("");
console.error("publishing publishes files on disk, but changesets creates the git tag at HEAD.");
console.error(
  "a dirty tree means the tag will not point at the published code. stage + commit, then re-run.",
);
process.exit(1);
