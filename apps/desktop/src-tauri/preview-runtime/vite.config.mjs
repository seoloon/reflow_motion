// ReFlow preview Vite config. GENERATED INTO THE USER'S PROJECT (.reflow/preview).
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const projectRequire = createRequire(resolve(root, "package.json"));

/** Directory of the package that owns a resolved file. */
function packageDir(file) {
  let dir = dirname(file);
  while (dir !== dirname(dir)) {
    const pkg = resolve(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** Resolve a package from the project, falling back to the location of a sibling Remotion package
 *  (pnpm/yarn-pnp layouts do not hoist `@remotion/player` next to the project). */
function find(name, fallbacks = []) {
  for (const from of [null, ...fallbacks]) {
    try {
      const req = from ? createRequire(projectRequire.resolve(from)) : projectRequire;
      return packageDir(req.resolve(name));
    } catch {
      /* try next */
    }
  }
  return null;
}

const player = find("@remotion/player", ["@remotion/studio", "@remotion/cli"]);
if (!player) {
  console.error(
    "ReFlow: @remotion/player was not found in this project. Install it with the same version as remotion (for example: npm i @remotion/player@<remotion version>).",
  );
  process.exit(2);
}

const alias = { "@remotion/player": player };
for (const dep of ["react", "react-dom", "remotion"]) {
  const dir = find(dep);
  if (dir) alias[dep] = dir;
}

export default {
  root: here,
  cacheDir: resolve(root, ".reflow/vite-cache"),
  publicDir: resolve(root, "public"),
  esbuild: { jsx: "automatic" },
  resolve: { alias, dedupe: ["react", "react-dom", "remotion"] },
  optimizeDeps: { include: ["react", "react-dom/client", "remotion", "@remotion/player"] },
  server: { host: "127.0.0.1", fs: { strict: false }, hmr: { overlay: false } },
  clearScreen: false,
  logLevel: "info",
};
