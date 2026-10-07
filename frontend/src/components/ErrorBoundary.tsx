import React, { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[XPO ErrorBoundary caught render error]:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            padding: '32px 24px',
            textAlign: 'center',
            background: 'var(--layer)',
            border: '1px solid var(--line)',
            margin: '24px auto',
            maxWidth: '640px',
            fontFamily: 'var(--font)',
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--err)', marginBottom: '8px' }}>
            System Notice
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--ink)', margin: '0 0 8px' }}>
            {this.props.fallbackTitle || 'Unable to display this view'}
          </h2>
          <p style={{ fontSize: '13.5px', color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.45 }}>
            {this.state.error?.message || 'An unexpected error interrupted rendering. Your saved data and offline queue remain intact.'}
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleReload}
              style={{ padding: '10px 20px', fontSize: '13px' }}
            >
              Reload View
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              style={{ padding: '10px 20px', fontSize: '13px' }}
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
