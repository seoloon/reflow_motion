// Installs ReFlow's own Vite into src-tauri/resources/preview-engine so packaged builds can run the preview app.
// Run before `tauri build` (wired into beforeBuildCommand). Installs for the *current* platform only:
// build each platform's installer on that platform (native optional dependencies are platform-specific).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/resources/preview-engine");
const vite = resolve(dir, "node_modules/vite/bin/vite.js");

if (existsSync(vite) && !process.argv.includes("--force")) {
  console.log("preview engine already installed:", vite);
} else {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0 || !existsSync(vite)) {
    console.error("Could not install the preview engine (vite).");
    process.exit(1);
  }
  console.log("preview engine installed:", vite);
}
