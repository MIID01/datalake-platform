import PolicyLibrary from '../../components/PolicyLibrary'
import GrcChat from '../../components/GrcChat'

// Company-wide, read-only policy library. The server (listGrcDocuments) filters by
// the access matrix, so each employee sees only the documents their role may read
// (Public/Internal for everyone; Confidential/Restricted stay scoped). The grounded
// assistant answers from the same access-scoped corpus.
export default function EmployeePolicies() {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <PolicyLibrary heading="Company Policies" />
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>Ask about a policy</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: 14 }}>The assistant answers only from policies you can access, and cites the source document.</p>
        <GrcChat compact />
      </div>
    </div>
  )
}
