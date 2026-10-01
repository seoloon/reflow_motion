import { Component, type ReactNode } from "react";
import { useLog } from "../stores/log";

/** Last line of defence: a rendering crash shows a readable message instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    useLog.getState().push({ source: "frontend", level: "ERROR", message: `${error.message}\n${error.stack ?? ""}` });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="welcome">
        <h1>Something went wrong.</h1>
        <p>The interface hit an unexpected problem. Your files are untouched. Reload to continue.</p>
        <pre className="diff">{this.state.error.message}</pre>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
