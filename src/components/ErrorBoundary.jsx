import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', minHeight: '400px', padding: '40px', textAlign: 'center', color: 'var(--text-primary)'
        }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239, 88, 41, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px'
          }}>
            <AlertTriangle size={32} color="#EF5829" />
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '32px', lineHeight: '1.6' }}>
            We encountered an unexpected error loading this page. Our engineers have been notified.
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 24px',
              background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px',
              fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            <RefreshCw size={18} /> Reload Page
          </button>
          
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <div style={{
              marginTop: '40px', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
              textAlign: 'left', maxWidth: '800px', overflowX: 'auto', border: '1px solid var(--border-primary)'
            }}>
              <code style={{ fontSize: '0.8rem', color: '#f87171' }}>{this.state.error.toString()}</code>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
