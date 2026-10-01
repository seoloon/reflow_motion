// Builds dev/fixture.json for the browser harness: project detection output + the project's source files.
// Usage: node dev/make-fixture.mjs <project dir>   (defaults to fixtures/sample-project)
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const dir = resolve(process.argv[2] ?? join(repo, "fixtures/sample-project"));
const json = execFileSync("cargo", ["run", "-q", "-p", "reflow-project", "--example", "detect", "--", dir], { cwd: repo, encoding: "utf8", shell: process.platform === "win32" });
const info = JSON.parse(json);

const files = {};
const skip = new Set(["node_modules", ".git", ".reflow", "out"]);
(function walk(d) {
  for (const name of readdirSync(d)) {
    if (skip.has(name)) continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (statSync(p).size < 200_000 && /\.(tsx?|jsx?|json|md|css)$/.test(name)) files[relative(dir, p).replaceAll("\\", "/")] = readFileSync(p, "utf8");
  }
})(dir);

writeFileSync(join(here, "fixture.json"), JSON.stringify({ info, files }, null, 2));
console.log(`fixture.json written: ${Object.keys(files).length} files, ${info.compositions.length} compositions`);
