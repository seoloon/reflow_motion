// Monaco is bundled locally (no CDN): required for offline use and the Tauri CSP.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";

self.MonacoEnvironment = {
  // each language service needs its own worker, otherwise the base worker rejects requests such as
  // "findDocumentColors" / "getFoldingRanges" with "Missing requestHandler or method"
  getWorker(_id: string, label: string) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new TsWorker();
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      default:
        return new EditorWorker();
    }
  },
};

const ts = monaco.typescript;
const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  jsx: ts.JsxEmit.ReactJSX,
  allowNonTsExtensions: true,
  allowJs: true,
  esModuleInterop: true,
};
// Syntax errors only for now: project `node_modules` types are not loaded into Monaco yet,
// so semantic checks would flag every `import ... from "remotion"` (see docs/roadmap.md, M6).
const diagnostics = { noSemanticValidation: true, noSyntaxValidation: false };
for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
  defaults.setCompilerOptions(compilerOptions);
  defaults.setDiagnosticsOptions(diagnostics);
}

loader.config({ monaco });

export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}
