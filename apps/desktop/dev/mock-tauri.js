// Browser-only stand-in for the Tauri IPC layer (dev harness; never shipped).
const BRIDGE = "http://127.0.0.1:5300";
const callbacks = new Map();
let nextCallback = 1;

window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  transformCallback(cb) {
    const id = nextCallback++;
    callbacks.set(id, cb);
    return id;
  },
  unregisterCallback: (id) => callbacks.delete(id),
  convertFileSrc: (p) => p,
  async invoke(cmd, args) {
    if (cmd === "plugin:event|listen") return nextCallback++;
    if (cmd.startsWith("plugin:event|")) return null;
    if (cmd === "plugin:dialog|open") return "harness-project";
    if (cmd.startsWith("plugin:")) return null;
    const r = await fetch(BRIDGE, { method: "POST", body: JSON.stringify({ cmd, args }) });
    const data = await r.json();
    if ("err" in data) throw data.err;
    return data.ok;
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
