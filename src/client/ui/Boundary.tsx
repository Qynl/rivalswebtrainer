/**
 * A shell that cannot go blank.
 *
 * If React throws while mounting the page there is nothing left to click, so
 * the failure has to become visible text rather than an empty body — the same
 * reason `bootGame` writes "WEBGL UNAVAILABLE" onto the menu instead of logging
 * and quitting.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class Boundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return { message: (err as Error)?.message ?? String(err) };
  }

  componentDidCatch(err: unknown, info: ErrorInfo): void {
    console.error(err, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="screen">
        <div className="panel small">
          <p className="eyebrow">SHELL FAILED</p>
          <h2>COULD NOT START</h2>
          <p className="note">{this.state.message}</p>
          <div className="row">
            <button className="primary" onClick={() => location.reload()}>
              RELOAD
            </button>
          </div>
        </div>
      </div>
    );
  }
}
