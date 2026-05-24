import React, { useState } from 'react';
import { Bot, RefreshCw, CheckCircle, Clock, AlertTriangle, Shield, Play, Pause, Activity, Cpu } from 'lucide-react';

const SERVICES = [
  { agent: 'Gatekeeper', name: 'gatekeeper-ai-service', type: 'Agent' },
  { agent: 'Controller', name: 'controller-ai-service', type: 'Agent' },
  { agent: 'Auditor', name: 'auditor-ai-service', type: 'Agent' },
  { agent: 'Qwen Inference', name: 'qwen-inference-service', type: 'Inference' },
  { agent: 'CV Agent', name: 'datalake-cv-agent', type: 'Inference' },
  { agent: 'PaddleOCR', name: 'datalake-ocr', type: 'Inference' }
];

export default function AIOperations() {
  const [statuses, setStatuses] = useState(
    SERVICES.reduce((acc, s) => {
      acc[s.name] = { 
        status: 'Unknown', 
        lastInvocation: '-', 
        errorCount: 0 
      };
      return acc;
    }, {})
  );
  
  const [isChecking, setIsChecking] = useState(false);

  const checkStatus = () => {
    setIsChecking(true);
    // Simulate pinging endpoints
    setTimeout(() => {
      const newStatuses = { ...statuses };
      SERVICES.forEach(s => {
        newStatuses[s.name] = {
          status: 'Running',
          lastInvocation: new Date().toLocaleTimeString(),
          errorCount: Math.floor(Math.random() * 3) // mock for now
        };
      });
      setStatuses(newStatuses);
      setIsChecking(false);
    }, 1500);
  };

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>AI Operations</h1>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: 4 }}>
            DTLK-ARCH-AI-002 · Core AI Services Dashboard
          </p>
        </div>
        <button 
          onClick={checkStatus}
          disabled={isChecking}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={16} className={isChecking ? 'spin' : ''} />
          {isChecking ? 'Checking...' : 'Check Status'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-surface)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Infrastructure Status</h3>
        </div>
        
        <table className="data-table" style={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              <th style={{ padding: '12px 24px' }}>Agent / Service</th>
              <th style={{ padding: '12px 24px' }}>Cloud Run Name</th>
              <th style={{ padding: '12px 24px' }}>Status</th>
              <th style={{ padding: '12px 24px' }}>Last Invocation</th>
              <th style={{ padding: '12px 24px' }}>Error Count (24h)</th>
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((s, i) => {
              const stat = statuses[s.name];
              const isRunning = stat.status === 'Running';
              return (
                <tr key={s.name} style={{ borderBottom: i < SERVICES.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {s.type === 'Agent' ? <Bot size={16} color="var(--sky-blue)" /> : <Cpu size={16} color="var(--green)" />}
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.agent}</span>
                      <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-tertiary)' }}>{s.type}</span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 24px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {s.name}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {isRunning ? (
                      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle size={12} /> {stat.status}
                      </span>
                    ) : (
                      <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Activity size={12} /> {stat.status}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '16px 24px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {stat.lastInvocation}
                  </td>
                  <td style={{ padding: '16px 24px' }}>
                    {stat.errorCount > 0 ? (
                      <span style={{ color: 'var(--red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={14} /> {stat.errorCount}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--green)', fontWeight: 600 }}>0</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
