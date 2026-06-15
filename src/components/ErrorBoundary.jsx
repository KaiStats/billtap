import { Component } from "react";
import * as Sentry from "@sentry/react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    Sentry.captureException(error, { extra: info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 max-w-md">
            <h2 className="text-white font-bold text-lg mb-2">Something went wrong</h2>
            <p className="text-white/40 text-sm mb-4">Please refresh the page or try again later.</p>
            <button
              onClick={() => window.location.reload()}
              className="text-sm text-white/60 underline"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}