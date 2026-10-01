// Dev harness backend: lets the UI run in a plain browser (no Tauri) against a COPY of the sample project.
// It uses the real Rust code for detection and source patching (cargo examples) and the real preview server.
//   node dev/bridge.mjs            -> http://127.0.0.1:5300   (then open http://localhost:1420/dev/mock.html with `pnpm dev`)
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const exe = (n) => join(repo, "target/debug/examples", n + (process.platform === "win32" ? ".exe" : ""));
const source = join(repo, "fixtures/sample-project");
const copy = join(repo, "target/harness-project");
const PORT = 5300;
const VITE_PORT = 5301;

// fresh copy of the project; dependencies are shared through a junction
rmSync(copy, { recursive: true, force: true });
cpSync(source, copy, { recursive: true, filter: (p) => !/node_modules|[\\/]out([\\/]|$)|[\\/]\.reflow/.test(p) });
symlinkSync(join(source, "node_modules"), join(copy, "node_modules"), "junction");
const genpreview = () => spawnSync(exe("genpreview"), [copy], { encoding: "utf8" });
genpreview();

const detect = () => {
  const r = spawnSync(exe("detect"), [copy], { encoding: "utf8" });
  if (r.status !== 0) throw Object.assign(new Error(r.stderr), { user: { title: "Detection failed.", hint: "", details: r.stderr } });
  return JSON.parse(r.stdout);
};

const inside = (rel) => {
  const full = resolve(copy, rel);
  if (full !== copy && !full.startsWith(copy + sep)) throw Object.assign(new Error("path escapes"), { user: { title: "That file operation was not possible.", hint: "", details: "path escapes the project" } });
  return full;
};

let vite = null;
const startVite = () =>
  new Promise((ok) => {
    if (vite) return ok();
    genpreview();
    vite = spawn("node", [join(repo, "apps/desktop/node_modules/vite/bin/vite.js"), "--config", join(copy, ".reflow/preview/vite.config.mjs"), "--port", String(VITE_PORT), "--strictPort"], { cwd: copy, stdio: "ignore" });
    const t = setInterval(async () => {
      try {
        if ((await fetch(`http://127.0.0.1:${VITE_PORT}/`)).ok) (clearInterval(t), ok());
      } catch {}
    }, 200);
  });

const SKIP = new Set(["node_modules", ".git", ".reflow", "out"]);
const walk = (d, out = []) => {
  for (const name of readdirSync(d)) {
    if (SKIP.has(name)) continue;
    const p = join(d, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(relative(copy, p).replaceAll("\\", "/"));
  }
  return out;
};

const handlers = {
  open_project: () => detect(),
  refresh_project: () => {
    if (vite) genpreview();
    return detect();
  },
  list_dir: ({ path }) =>
    readdirSync(inside(path || "."), { withFileTypes: true })
      .filter((e) => !SKIP.has(e.name))
      .map((e) => ({ name: e.name, path: path ? `${path}/${e.name}` : e.name, is_dir: e.isDirectory() }))
      .sort((a, b) => b.is_dir - a.is_dir || a.name.localeCompare(b.name)),
  read_file: ({ path }) => readFileSync(inside(path), "utf8"),
  write_file: ({ path, content }) => (mkdirSync(dirname(inside(path)), { recursive: true }), writeFileSync(inside(path), content), null),
  list_files: () => walk(copy).sort(),
  apply_edit: ({ source, edit }) => {
    const r = spawnSync(exe("apply"), { input: JSON.stringify({ source, edit }), encoding: "utf8" });
    if (r.status !== 0) throw Object.assign(new Error(r.stderr), { user: { title: "That change cannot be applied to the source.", hint: "The value is not a plain literal in your code.", details: r.stderr } });
    return r.stdout;
  },
  start_preview: async () => (await startVite(), { port: VITE_PORT, mode: "player", skipped: [] }),
  stop_preview: () => null,
  render_jobs: () => [],
  render_presets: () => JSON.parse(readFileSync(join(repo, "crates/renderer/presets.json"), "utf8")),
  render_enqueue: () => 1,
  list_templates: () => [{ id: "title", name: "Title card", description: "One 1080p composition" }],
  git_status: () => {
    throw Object.assign(new Error("not a repo"), { user: { title: "This project is not a Git repository.", hint: "Run git init.", details: "" } });
  },
  git_branches: () => [],
};

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  let body = "";
  for await (const c of req) body += c;
  const { cmd, args } = JSON.parse(body || "{}");
  try {
    const h = handlers[cmd];
    if (!h) throw Object.assign(new Error(`not available in the harness: ${cmd}`), { user: { title: "Not available in the browser harness.", hint: cmd, details: cmd } });
    const result = await h(args ?? {});
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: result ?? null }));
  } catch (e) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ err: e.user ?? { title: "Harness error.", hint: "", details: String(e) } }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`harness bridge on http://127.0.0.1:${PORT}, project copy: ${copy}`));

process.on("exit", () => vite?.kill());
process.on("SIGINT", () => process.exit(0));
