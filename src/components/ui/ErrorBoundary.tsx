import React from 'react';
import { AlertOctagon, Copy, Check, RefreshCw, RotateCcw } from 'lucide-react';

/**
 * A crash screen that is actually useful.
 *
 * Render errors used to blank the app; now the shell survives, the technician
 * keeps their navigation, and the details can be copied into a message.
 */

interface Props {
  children: React.ReactNode;
  /** shown in the fallback, e.g. "Dispatch board" */
  label?: string;
  /** compact fallback for a panel inside a page */
  compact?: boolean;
}

interface State {
  error: Error | null;
  copied: boolean;
  showDetail: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, copied: false, showDetail: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a breadcrumb in the console for debugging; no third-party telemetry.
    console.error('[Telesom F1] UI error:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, copied: false, showDetail: false });

  private copy = async () => {
    const { error } = this.state;
    const text = [error?.name, error?.message, error?.stack].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 1800);
    } catch {
      this.setState({ showDetail: true });
    }
  };

  render() {
    const { error, copied, showDetail } = this.state;
    const { children, label, compact } = this.props;

    if (!error) return children;

    return (
      <div className={compact ? 'p-3' : 'min-h-[60vh] flex items-center justify-center p-4'}>
        <div className="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-5 shadow-sm">
          <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <AlertOctagon className="w-5 h-5" />
          </div>

          <h2 className="mt-3 text-base font-extrabold text-slate-900">
            {label ? `${label} — ` : ''}Something broke / Wax baa jabay
          </h2>
          <p className="mt-1 text-[12px] text-slate-600 leading-relaxed">
            Your data is safe. Nothing was sent to the server from this screen.
            <br />
            <span className="text-slate-500">
              Xogtaadu waa badbaado. Waxba lama dirin server-ka shaashadan.
            </span>
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload / Dib u cusbooneysii
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Try again / Isku day
            </button>
            <button
              type="button"
              onClick={() => void this.copy()}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => this.setState({ showDetail: !showDetail })}
            className="mt-3 text-[10px] font-semibold text-slate-500 underline cursor-pointer"
          >
            {showDetail ? 'Hide technical detail' : 'Show technical detail'}
          </button>

          {showDetail && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-slate-900 text-slate-100 text-[10px] p-2.5 whitespace-pre-wrap">
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
