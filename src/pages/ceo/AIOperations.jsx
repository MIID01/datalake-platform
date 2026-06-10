/**
 * AIOperations.jsx — DTLK-ARCH-AI-002
 *
 * AI Operations Dashboard — CEO only.
 * All status is derived from getAiServiceHealth Cloud Function which queries
 * Cloud Run Admin API + Cloud Monitoring at render time. No mocking, no
 * setTimeout, no hardcoded "Running", no client-stamped timestamps.
 *
 * STATUS INTEGRITY RULE (CLAUDE.md):
 *   A green/healthy state is shown ONLY when the server-side check returns
 *   status="HEALTHY". Any failure to fetch → "Unknown / Not checked" (grey).
 *   Services absent from Cloud Run → "Not deployed" (neutral, never green).
 */

import React, { useState, useCallback } from 'react';
import {
  Bot, RefreshCw, CheckCircle, AlertTriangle, XCircle,
  MinusCircle, HelpCircle, Cpu, Clock, Activity, Info,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { GET_AI_SERVICE_HEALTH_URL } from '../../lib/firebase';

// ── Health criteria constants — must match aiHealth.js ───────────────────────
const CRITERIA = {
  HEALTHY:      'ready AND has 2xx AND 5xx rate < 20% over 30d',
  DEGRADED:     'ready AND 5xx rate 20–50% over 30d',
  BROKEN:       'ready AND (0 successes OR 5xx rate ≥ 50%) over 30d — /health 200 is NOT trusted',
  IDLE:         'ready AND 0 requests over 30d',
  ERROR:        'Cloud Run Ready condition = false',
  NOT_DEPLOYED: 'Service absent from Cloud Run me-central2',
  UNKNOWN:      'Health check not yet run or API call failed',
};

// ── Status display config ─────────────────────────────────────────────────────
const STATUS_CONFIG = {
  HEALTHY: {
    label: 'Healthy',
    color: '#34BF3A',
    bg:    'rgba(52,191,58,0.12)',
    Icon:  CheckCircle,
  },
  DEGRADED: {
    label: 'Degraded',
    color: '#F59E0B',
    bg:    'rgba(245,158,11,0.12)',
    Icon:  AlertTriangle,
  },
  BROKEN: {
    label: 'Broken',
    color: '#C0392B',
    bg:    'rgba(192,57,43,0.14)',
    Icon:  XCircle,
  },
  IDLE: {
    label: 'Idle',
    color: '#64748B',
    bg:    'rgba(100,116,139,0.12)',
    Icon:  MinusCircle,
  },
  ERROR: {
    label: 'Error',
    color: '#EF5829',
    bg:    'rgba(239,88,41,0.12)',
    Icon:  XCircle,
  },
  NOT_DEPLOYED: {
    label: 'Not deployed',
    color: '#94A3B8',
    bg:    'rgba(148,163,184,0.10)',
    Icon:  MinusCircle,
  },
  UNKNOWN: {
    label: 'Not checked',
    color: '#94A3B8',
    bg:    'rgba(148,163,184,0.10)',
    Icon:  HelpCircle,
  },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;
  const { Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600,
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33`,
    }}>
      <Icon size={12} />
      {cfg.label}
    </span>
  );
}

function MetricCell({ value, suffix = '', na = false, warn = false, dim = false }) {
  if (na) return <span style={{ color: '#94A3B8', fontSize: '0.8rem' }}>—</span>;
  return (
    <span style={{
      fontSize: '0.85rem', fontWeight: 600,
      color: warn ? '#EF5829' : dim ? '#94A3B8' : 'var(--text-primary)',
    }}>
      {value}{suffix}
    </span>
  );
}

function formatTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.round(diffMs / 60000);
    const diffH   = Math.round(diffMs / 3600000);
    if (diffMin < 60)  return `${diffMin}m ago`;
    if (diffH   < 24)  return `${diffH}h ago`;
    return d.toLocaleDateString('en-SA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

const ROLE_ICON = {
  inference: <Cpu size={15} color="#1598CC" />,
  ocr:       <Cpu size={15} color="#9C27B0" />,
  'cv-agent':<Cpu size={15} color="#F59E0B" />,
  function:  <Bot size={15} color="#9C27B0" />,
  agent:     <Bot size={15} color="#94A3B8" />,
};

export default function AIOperations() {
  const [data,       setData]       = useState(null);   // null = not fetched yet
  const [loading,    setLoading]    = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      const token = await user.getIdToken();

      const res = await fetch(GET_AI_SERVICE_HEALTH_URL, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(35000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Health check returned ${res.status}: ${body.slice(0, 200)}`);
      }
      setData(await res.json());
    } catch (err) {
      setFetchError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const summary = data?.summary;
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt) : null;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>AI Operations</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 0 }}>
            DTLK-ARCH-AI-002 · All status is live from Cloud Run + Cloud Monitoring — no simulated data
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={loading}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Checking…' : data ? 'Refresh' : 'Run Health Check'}
        </button>
      </div>

      {/* ── Pre-check state: explain what the button does ── */}
      {!data && !loading && !fetchError && (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <HelpCircle size={36} style={{ color: '#94A3B8', marginBottom: 12 }} />
          <p style={{ fontWeight: 600, marginBottom: 8 }}>No health data</p>
          <p style={{ fontSize: '0.82rem', maxWidth: 460, margin: '0 auto' }}>
            Click <strong>Run Health Check</strong> to query Cloud Run and Cloud Monitoring for real service status.
            Status is never assumed — unverified services show "Not checked", not "Running".
          </p>
        </div>
      )}

      {/* ── Fetch error ── */}
      {fetchError && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 16, background: 'rgba(239,88,41,0.06)', border: '1px solid rgba(239,88,41,0.2)' }}>
          <p style={{ margin: 0, color: '#EF5829', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <XCircle size={15} />
            <strong>Health check failed:</strong> {fetchError}
          </p>
        </div>
      )}

      {/* ── Results ── */}
      {data && (
        <>
          {/* Summary strip */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Healthy',      count: summary.healthy,      color: '#34BF3A' },
              { label: 'Degraded',     count: summary.degraded,     color: '#F59E0B' },
              { label: 'Broken',       count: summary.broken,       color: '#C0392B' },
              { label: 'Idle',         count: summary.idle,         color: '#64748B' },
              { label: 'Error',        count: summary.error,        color: '#EF5829' },
              { label: 'Not deployed', count: summary.not_deployed, color: '#94A3B8' },
            ].map(({ label, count, color }) => (
              <div key={label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{count}</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}
            <div className="card" style={{ padding: '10px 18px', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={13} style={{ color: '#94A3B8' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                Checked {checkedAt ? checkedAt.toLocaleTimeString('en-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                {' · '}{data.region}
              </span>
            </div>
          </div>

          {/* Service table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-surface)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>Infrastructure Status</h3>
              <span style={{ fontSize: '0.73rem', color: 'var(--text-tertiary)' }}>
                Source: Cloud Run Admin API + Cloud Monitoring · project {data.project}
              </span>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-surface)' }}>
                  {['Service', 'Cloud Run Name', 'Status', 'Last Request', '30d Requests', '30d 5xx', 'Error Rate'].map((h) => (
                    <th key={h} style={{ padding: '10px 20px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.services.map((svc, i) => {
                  const h = svc.health;
                  const notDeployed = h.status === 'NOT_DEPLOYED';
                  return (
                    <tr key={svc.name} style={{ borderBottom: i < data.services.length - 1 ? '1px solid var(--border-primary)' : 'none', opacity: notDeployed ? 0.6 : 1 }}>
                      {/* Service name */}
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {ROLE_ICON[svc.role] || <Bot size={15} color="#94A3B8" />}
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.87rem' }}>{svc.label}</div>
                            {h.note && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2, maxWidth: 220 }}>
                                {h.note}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Cloud Run name */}
                      <td style={{ padding: '14px 20px', fontFamily: 'monospace', fontSize: '0.77rem', color: 'var(--text-secondary)' }}>
                        {svc.name}
                        {h.latestRevision && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 1 }}>
                            rev: {h.latestRevision.split('-').slice(-2).join('-')}
                          </div>
                        )}
                      </td>
                      {/* Status */}
                      <td style={{ padding: '14px 20px' }}>
                        <StatusBadge status={h.status} />
                      </td>
                      {/* Last request */}
                      <td style={{ padding: '14px 20px' }}>
                        {notDeployed ? (
                          <MetricCell na />
                        ) : h.lastRequestTime ? (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {formatTime(h.lastRequestTime)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>No requests in 30d</span>
                        )}
                        {h.idle24h && h.lastRequestTime && (
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: 1 }}>idle 24h</div>
                        )}
                      </td>
                      {/* 30d requests */}
                      <td style={{ padding: '14px 20px' }}>
                        <MetricCell value={h.requestsWindow} na={h.requestsWindow === null} dim={h.requestsWindow === 0} />
                      </td>
                      {/* 30d 5xx */}
                      <td style={{ padding: '14px 20px' }}>
                        <MetricCell
                          value={h.errors5xxWindow}
                          na={h.errors5xxWindow === null}
                          warn={h.errors5xxWindow > 0}
                          dim={h.errors5xxWindow === 0}
                        />
                      </td>
                      {/* Error rate */}
                      <td style={{ padding: '14px 20px' }}>
                        {h.errorRateWindow === null ? (
                          <MetricCell na />
                        ) : (
                          <MetricCell
                            value={h.errorRateWindow}
                            suffix="%"
                            warn={h.errorRateWindow >= 20}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Health criteria footnote */}
          <div className="card" style={{ marginTop: 16, padding: '14px 20px', background: 'var(--bg-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Info size={14} style={{ color: '#94A3B8', marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                <strong style={{ color: 'var(--text-secondary)' }}>Health criteria (30-day window):</strong>{' '}
                <strong style={{ color: '#34BF3A' }}>Healthy</strong> = ready, has successes, 5xx &lt; 20%.{' '}
                <strong style={{ color: '#F59E0B' }}>Degraded</strong> = 5xx 20–50%.{' '}
                <strong style={{ color: '#C0392B' }}>Broken</strong> = 0 successes or 5xx ≥ 50% (a 200 /health is NOT trusted).{' '}
                <strong style={{ color: '#64748B' }}>Idle</strong> = ready but 0 requests in 30d.{' '}
                <strong style={{ color: '#EF5829' }}>Error</strong> = Ready condition false.{' '}
                <strong style={{ color: '#94A3B8' }}>Not deployed</strong> = absent from Cloud Run me-central2.
                "idle 24h" notes a quiet last day, separate from the 30d verdict.
                Data source: Cloud Run Admin API v2 + Cloud Monitoring <code>run.googleapis.com/request_count</code>.
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
