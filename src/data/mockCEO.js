// CEO Command Center — Mock Data

export const ceoKPIs = {
  monthlyRevenue: { value: 847500, target: 800000, trend: 5.9, unit: 'SAR' },
  activeEngineers: { value: 23, trend: 2, unit: '' },
  cashPosition: { value: 2145000, threshold: 500000, trend: 12.3, unit: 'SAR' },
  complianceScore: { value: 94, trend: 2, unit: '%' },
}

export const criticalAlerts = [
  {
    id: 'ca-001',
    type: 'contract_expiry',
    message: 'Engineer Ahmed Al-Rashidi contract expires in 5 days',
    action: 'Initiate Renewal',
    route: '/ceo/contracts',
  },
  {
    id: 'ca-002',
    type: 'capa_overdue',
    message: 'CAPA #CAP-2026-014 is 3 days overdue',
    action: 'Close CAPA',
    route: '/ceo/compliance',
  },
]

export const pendingApprovals = [
  {
    id: 'apr-001',
    type: 'invoice',
    icon: '💰',
    title: 'Invoice #INV-2026-047: SAR 48,000 — Emkan Q2 Development Services',
    requester: 'Controller AI',
    submitted: '2026-04-19T08:30:00',
    sla: 24,
    slaRemaining: 8,
    actions: ['Approve', 'Reject'],
  },
  {
    id: 'apr-002',
    type: 'hire',
    icon: '👤',
    title: 'Hire Approval: Khalid M. — Senior Java Engineer (87% match)',
    requester: 'Gatekeeper AI',
    submitted: '2026-04-18T14:15:00',
    sla: 48,
    slaRemaining: 22,
    actions: ['HIRED', 'PASS'],
  },
  {
    id: 'apr-003',
    type: 'invoice',
    icon: '💰',
    title: 'Invoice #INV-2026-048: SAR 32,000 — Ministry of Health Sprint 4',
    requester: 'Controller AI',
    submitted: '2026-04-19T09:00:00',
    sla: 24,
    slaRemaining: 14,
    actions: ['Approve', 'Reject'],
  },
  {
    id: 'apr-004',
    type: 'expense',
    icon: '💳',
    title: 'Expense Approval: SAR 2,400 — Cloud Summit Conference Tickets',
    requester: 'Controller AI',
    submitted: '2026-04-18T10:00:00',
    sla: 48,
    slaRemaining: 32,
    actions: ['Approve', 'Reject'],
  },
  {
    id: 'apr-005',
    type: 'gift',
    icon: '🎁',
    title: 'Gift Approval: SAR 800 Eid Gift Basket from NEOM vendor',
    requester: 'Auditor AI',
    submitted: '2026-04-19T06:00:00',
    sla: 24,
    slaRemaining: 4,
    actions: ['Approve', 'Reject'],
  },
  {
    id: 'apr-006',
    type: 'leave',
    icon: '🏖️',
    title: 'Leave Override: Omar S. — 5 days Annual Leave (PM denied, escalated)',
    requester: 'Gatekeeper AI',
    submitted: '2026-04-19T11:00:00',
    sla: 24,
    slaRemaining: 18,
    actions: ['Approve', 'Deny'],
  },
  {
    id: 'apr-007',
    type: 'contract_risk',
    icon: '⚠️',
    title: 'Contract Risk Override: NEOM proposal flagged HIGH risk — missing SAMA clause',
    requester: 'Auditor AI',
    submitted: '2026-04-20T07:00:00',
    sla: 4,
    slaRemaining: 2,
    actions: ['Proceed Anyway', 'Block'],
  },
  {
    id: 'apr-008',
    type: 'capa',
    icon: '🛡️',
    title: 'CAPA Closure: #CAP-2026-012 — Missing backup verification corrected',
    requester: 'Auditor AI',
    submitted: '2026-04-17T16:00:00',
    sla: 48,
    slaRemaining: 6,
    actions: ['Close CAPA', 'Reopen'],
  },
]

export const activityFeed = [
  { id: 'af-001', text: 'Resume parsed: 87% skill match for Java Engineer role', agent: 'Gatekeeper', time: '09:14 AM', status: 'success' },
  { id: 'af-002', text: 'Proposal BLOCKED: Missing SAMA audit rights clause', agent: 'Auditor', time: '09:22 AM', status: 'error' },
  { id: 'af-003', text: 'Timesheet validated: PO-2024-018, 160hrs within limit', agent: 'Controller', time: '09:35 AM', status: 'success' },
  { id: 'af-004', text: 'Invoice DRAFT created: SAR 48,000 for Emkan Q2', agent: 'Controller', time: '09:41 AM', status: 'info' },
  { id: 'af-005', text: 'PDPL purge: 3 candidate records deleted (30-day expiry)', agent: 'Gatekeeper', time: '03:00 AM', status: 'info' },
  { id: 'af-006', text: 'Contract expiry alert: Engineer Ahmed — 5 days remaining', agent: 'Auditor', time: '07:00 AM', status: 'warning' },
  { id: 'af-007', text: 'Leave request auto-approved: Sick leave with medical cert', agent: 'Gatekeeper', time: '08:15 AM', status: 'success' },
  { id: 'af-008', text: 'GOSI certificate regenerated for Mohammed Al-Fahad', agent: 'Controller', time: '08:30 AM', status: 'success' },
  { id: 'af-009', text: 'Compliance check passed: All NDA signatures current', agent: 'Auditor', time: '06:00 AM', status: 'success' },
  { id: 'af-010', text: 'PO budget warning: PO-2024-022 at 85% utilization', agent: 'Controller', time: '09:50 AM', status: 'warning' },
  { id: 'af-011', text: 'New RFP discovered: Ministry of Finance — Data Analytics Platform', agent: 'Gatekeeper', time: '10:05 AM', status: 'info' },
  { id: 'af-012', text: 'Offboarding checklist initiated: Engineer Sara K.', agent: 'Gatekeeper', time: '10:12 AM', status: 'info' },
]

export const pipelineData = {
  columns: [
    {
      id: 'new', title: 'New RFPs', cards: [
        { id: 'rfp-001', title: 'Ministry of Finance — Data Analytics Platform', client: 'MOF', value: 1200000, deadline: '2026-05-15', source: 'Etimad', score: 82 },
        { id: 'rfp-002', title: 'NEOM — Smart City IoT Backend', client: 'NEOM', value: 3500000, deadline: '2026-05-20', source: 'Direct', score: 74 },
        { id: 'rfp-003', title: 'Saudi Red Crescent — Donor Management System', client: 'SRCA', value: 450000, deadline: '2026-04-30', source: 'Etimad', score: 91 },
      ]
    },
    {
      id: 'evaluating', title: 'Evaluating', cards: [
        { id: 'rfp-004', title: 'KACST — Research Data Lake', client: 'KACST', value: 890000, deadline: '2026-05-10', source: 'Monafasat', score: 88 },
      ]
    },
    {
      id: 'bidding', title: 'Bidding', cards: [
        { id: 'rfp-005', title: 'Aramco — Downstream Analytics Dashboard', client: 'Aramco', value: 2100000, deadline: '2026-05-25', source: 'IKTVA', score: 79 },
        { id: 'rfp-006', title: 'STC — Customer 360 Platform', client: 'STC', value: 1650000, deadline: '2026-05-18', source: 'Direct', score: 85 },
      ]
    },
    {
      id: 'submitted', title: 'Submitted', cards: [
        { id: 'rfp-007', title: 'MDDA — Media Analytics Engine', client: 'MDDA', value: 780000, deadline: '2026-06-01', source: 'Etimad', score: 72 },
      ]
    },
    {
      id: 'won', title: 'WON', cards: [
        { id: 'rfp-008', title: 'Emkan — Financial Platform Q2', client: 'Emkan', value: 520000, deadline: '2026-04-01', source: 'Direct', score: 95 },
      ]
    },
    {
      id: 'lost', title: 'LOST', cards: [
        { id: 'rfp-009', title: 'RCJY — Industrial Zone Portal', client: 'RCJY', value: 670000, deadline: '2026-03-15', source: 'Monafasat', score: 65 },
      ]
    },
  ],
  analytics: {
    winRate: [
      { month: 'May', rate: 33 }, { month: 'Jun', rate: 40 }, { month: 'Jul', rate: 50 },
      { month: 'Aug', rate: 45 }, { month: 'Sep', rate: 55 }, { month: 'Oct', rate: 60 },
      { month: 'Nov', rate: 50 }, { month: 'Dec', rate: 65 }, { month: 'Jan', rate: 58 },
      { month: 'Feb', rate: 62 }, { month: 'Mar', rate: 70 }, { month: 'Apr', rate: 67 },
    ],
    revenueByClient: [
      { client: 'Emkan', revenue: 520000 }, { client: 'Aramco', revenue: 480000 },
      { client: 'STC', revenue: 380000 }, { client: 'MOH', revenue: 320000 },
      { client: 'NEOM', revenue: 290000 }, { client: 'KACST', revenue: 180000 },
    ],
  },
  vendors: [
    { portal: 'Etimad', status: 'Registered', date: '2025-06-15', expiry: '2026-06-15', alert: false },
    { portal: 'Monafasat', status: 'Registered', date: '2025-08-20', expiry: '2026-08-20', alert: false },
    { portal: 'IKTVA', status: 'Registered', date: '2025-11-01', expiry: '2026-11-01', alert: false },
    { portal: 'NUPCO', status: 'Pending', date: '2026-03-10', expiry: null, alert: true },
    { portal: 'Tabadul', status: 'Not Started', date: null, expiry: null, alert: false },
    { portal: 'Alinma Bank', status: 'Registered', date: '2025-09-05', expiry: '2026-04-28', alert: true },
  ],
}

export const talentData = {
  candidates: [
    { id: 'cand-001', name: 'Khalid M.', skills: 'Java, Spring Boot, AWS', match: 87, source: 'LinkedIn', daysInPipeline: 5, stage: 'screened' },
    { id: 'cand-002', name: 'Sara A.', skills: 'Python, TensorFlow, GCP', match: 92, source: 'Referral', daysInPipeline: 3, stage: 'interview_scheduled' },
    { id: 'cand-003', name: 'Ahmed K.', skills: 'React, Node.js, TypeScript', match: 78, source: 'Bayt.com', daysInPipeline: 8, stage: 'consent_pending' },
    { id: 'cand-004', name: 'Fatima R.', skills: 'Data Engineering, Spark, Kafka', match: 84, source: 'LinkedIn', daysInPipeline: 12, stage: 'offer_pending' },
    { id: 'cand-005', name: 'Masked (No Consent)', skills: 'DevOps, Kubernetes, Terraform', match: 71, source: 'Indeed', daysInPipeline: 2, stage: 'received' },
  ],
  engineers: [
    { id: 'EMP-001', name: 'Mohammed Al-Fahad', client: 'Emkan', role: 'Senior Java Engineer', start: '2025-06-01', end: '2026-06-01', daysRemaining: 42, status: 'Active', hours: 152, leave: 8 },
    { id: 'EMP-002', name: 'Ahmed Al-Rashidi', client: 'MOH', role: 'Full Stack Developer', start: '2025-03-15', end: '2026-04-25', daysRemaining: 5, status: 'Expiring', hours: 160, leave: 3 },
    { id: 'EMP-003', name: 'Noura Al-Shehri', client: 'STC', role: 'Data Engineer', start: '2025-09-01', end: '2026-09-01', daysRemaining: 134, status: 'Active', hours: 148, leave: 12 },
    { id: 'EMP-004', name: 'Omar Sultan', client: 'Aramco', role: 'Cloud Architect', start: '2025-11-01', end: '2026-11-01', daysRemaining: 195, status: 'Active', hours: 156, leave: 15 },
    { id: 'EMP-005', name: 'Reem Al-Qahtani', client: 'KACST', role: 'ML Engineer', start: '2025-07-15', end: '2026-07-15', daysRemaining: 86, status: 'Active', hours: 144, leave: 10 },
    { id: 'EMP-006', name: 'Hassan Malik', client: 'Emkan', role: 'DevOps Engineer', start: '2026-01-01', end: '2027-01-01', daysRemaining: 256, status: 'Active', hours: 160, leave: 18 },
    { id: 'EMP-007', name: 'Lina K.', client: 'NEOM', role: 'Frontend Developer', start: '2025-04-01', end: '2026-04-30', daysRemaining: 10, status: 'Expiring', hours: 140, leave: 5 },
  ],
  offboarding: [
    { id: 'EMP-002', name: 'Ahmed Al-Rashidi', client: 'MOH', endDate: '2026-04-25', status: 'In Progress', actions: ['Extend Contract'] },
    { id: 'EMP-007', name: 'Lina K.', client: 'NEOM', endDate: '2026-04-30', status: 'Pending', actions: ['Initiate Offboarding', 'Extend Contract'] },
  ],
}

export const financeData = {
  overview: {
    revenueMTD: { value: 847500, label: 'Revenue MTD', trend: 5.9 },
    outstanding: { value: 324000, label: 'Outstanding Invoices', count: 7 },
    payrollMTD: { value: 385000, label: 'Payroll MTD', headcount: 23 },
    grossMargin: { value: 54.6, label: 'Gross Margin %', trend: 2.1 },
    poUtilization: { value: 78, label: 'PO Utilization', unit: '%' },
    overduePayments: { value: 96000, label: 'Overdue Payments', count: 2 },
  },
  invoices: [
    { id: 'INV-2026-047', client: 'Emkan', amount: 48000, date: '2026-04-15', dueDate: '2026-05-15', status: 'Draft', po: 'PO-2024-018', engineer: 'Mohammed Al-Fahad' },
    { id: 'INV-2026-048', client: 'MOH', amount: 32000, date: '2026-04-15', dueDate: '2026-05-15', status: 'Draft', po: 'PO-2024-022', engineer: 'Ahmed Al-Rashidi' },
    { id: 'INV-2026-045', client: 'STC', amount: 44000, date: '2026-04-01', dueDate: '2026-05-01', status: 'Sent', po: 'PO-2024-019', engineer: 'Noura Al-Shehri' },
    { id: 'INV-2026-042', client: 'Aramco', amount: 56000, date: '2026-03-15', dueDate: '2026-04-15', status: 'Overdue', po: 'PO-2024-020', engineer: 'Omar Sultan' },
    { id: 'INV-2026-040', client: 'KACST', amount: 40000, date: '2026-03-15', dueDate: '2026-04-15', status: 'Overdue', po: 'PO-2024-021', engineer: 'Reem Al-Qahtani' },
    { id: 'INV-2026-038', client: 'Emkan', amount: 48000, date: '2026-03-01', dueDate: '2026-04-01', status: 'Paid', po: 'PO-2024-018', engineer: 'Hassan Malik' },
    { id: 'INV-2026-035', client: 'STC', amount: 44000, date: '2026-02-15', dueDate: '2026-03-15', status: 'Paid', po: 'PO-2024-019', engineer: 'Noura Al-Shehri' },
  ],
  cashFlow: [
    { month: 'May', revenue: 720000, expenses: 450000 },
    { month: 'Jun', revenue: 780000, expenses: 460000 },
    { month: 'Jul', revenue: 810000, expenses: 470000 },
    { month: 'Aug', revenue: 750000, expenses: 455000 },
    { month: 'Sep', revenue: 830000, expenses: 480000 },
    { month: 'Oct', revenue: 860000, expenses: 490000 },
    { month: 'Nov', revenue: 890000, expenses: 495000 },
    { month: 'Dec', revenue: 820000, expenses: 500000 },
    { month: 'Jan', revenue: 870000, expenses: 510000 },
    { month: 'Feb', revenue: 900000, expenses: 508000 },
    { month: 'Mar', revenue: 830000, expenses: 500000 },
    { month: 'Apr', revenue: 847500, expenses: 495000 },
  ],
}

export const contractsData = [
  { id: 'CTR-2026-001', type: 'Employment', party: 'Mohammed Al-Fahad', start: '2025-06-01', end: '2026-06-01', value: 300000, status: 'Active', risk: 'Low' },
  { id: 'CTR-2026-002', type: 'Employment', party: 'Ahmed Al-Rashidi', start: '2025-03-15', end: '2026-04-25', value: 280000, status: 'Expiring', risk: 'Medium' },
  { id: 'CTR-2026-003', type: 'Client SLA', party: 'Emkan', start: '2025-01-01', end: '2026-12-31', value: 1200000, status: 'Active', risk: 'Low' },
  { id: 'CTR-2026-004', type: 'Client SLA', party: 'MOH', start: '2025-06-01', end: '2026-05-31', value: 850000, status: 'Active', risk: 'Low' },
  { id: 'CTR-2026-005', type: 'NDA', party: 'Aramco', start: '2025-11-01', end: '2027-11-01', value: 0, status: 'Active', risk: 'Low' },
  { id: 'CTR-2026-006', type: 'Client SLA', party: 'STC', start: '2025-09-01', end: '2026-08-31', value: 960000, status: 'Active', risk: 'Low' },
  { id: 'CTR-2026-007', type: 'Employment', party: 'Lina K.', start: '2025-04-01', end: '2026-04-30', value: 252000, status: 'Expiring', risk: 'High' },
  { id: 'CTR-2026-008', type: 'Vendor', party: 'AWS', start: '2025-01-01', end: '2025-12-31', value: 65000, status: 'Expired', risk: 'Medium' },
]

export const complianceData = {
  score: 94,
  breakdown: { NCA: 96, SAMA: 92, SDAIA: 95, MHRSD: 93 },
  capas: [
    { id: 'CAP-2026-012', source: 'Internal Audit', type: 'Corrective', rootCause: 'Missing backup verification', status: 'Pending Closure', dueDate: '2026-04-22', daysOverdue: 0, risk: 'Medium' },
    { id: 'CAP-2026-014', source: 'Compliance Check', type: 'Corrective', rootCause: 'Expired NDA template used', status: 'Overdue', dueDate: '2026-04-17', daysOverdue: 3, risk: 'High' },
    { id: 'CAP-2026-015', source: 'Client Audit', type: 'Preventive', rootCause: 'No encryption-at-rest for temp files', status: 'In Progress', dueDate: '2026-05-01', daysOverdue: 0, risk: 'High' },
  ],
  recentEvents: [
    { date: '2026-04-20', event: 'NDA signature check — All current', status: 'pass', framework: 'NCA' },
    { date: '2026-04-20', event: 'PDPL 30-day candidate purge executed', status: 'pass', framework: 'SDAIA' },
    { date: '2026-04-19', event: 'PO budget validation — 2 near limit', status: 'warning', framework: 'SAMA' },
    { date: '2026-04-19', event: 'Expired AWS vendor contract detected', status: 'fail', framework: 'NCA' },
    { date: '2026-04-18', event: 'GOSI certificate renewal check — All valid', status: 'pass', framework: 'MHRSD' },
    { date: '2026-04-18', event: 'Backup encryption verification — Fixed', status: 'pass', framework: 'NCA' },
  ],
  whistleblower: [
    { id: 'WB-2026-003', receivedDate: '2026-04-15', category: 'Data Handling', severity: 'Standard', status: 'Investigating', ack48hr: true, triage5day: true },
    { id: 'WB-2026-002', receivedDate: '2026-03-28', category: 'Policy Violation', severity: 'Standard', status: 'Closed', ack48hr: true, triage5day: true },
  ],
}

export const analyticsData = {
  revenueTrend: [
    { month: 'May 25', actual: 720000, target: 700000 }, { month: 'Jun', actual: 780000, target: 720000 },
    { month: 'Jul', actual: 810000, target: 740000 }, { month: 'Aug', actual: 750000, target: 760000 },
    { month: 'Sep', actual: 830000, target: 780000 }, { month: 'Oct', actual: 860000, target: 800000 },
    { month: 'Nov', actual: 890000, target: 810000 }, { month: 'Dec', actual: 820000, target: 820000 },
    { month: 'Jan 26', actual: 870000, target: 830000 }, { month: 'Feb', actual: 900000, target: 840000 },
    { month: 'Mar', actual: 830000, target: 850000 }, { month: 'Apr', actual: 847500, target: 800000 },
  ],
  zeroTouchRatio: 93.2,
  revenuePerEngineer: { value: 36848, trend: 3.2 },
  timeToHire: { value: 14, trend: -2 },
  gcpCosts: [
    { month: 'Jan', compute: 3200, storage: 1800, bigquery: 900, networking: 400, other: 300 },
    { month: 'Feb', compute: 3100, storage: 1900, bigquery: 850, networking: 420, other: 280 },
    { month: 'Mar', compute: 3400, storage: 2000, bigquery: 950, networking: 450, other: 320 },
    { month: 'Apr', compute: 3300, storage: 2100, bigquery: 1000, networking: 460, other: 310 },
  ],
}

export const systemHealth = [
  { name: 'Gatekeeper AI', status: 'green', lastExec: '2 min ago', successRate: 99.2, queueDepth: 3, metric: '99.2% success rate' },
  { name: 'Auditor AI', status: 'green', lastExec: '5 min ago', successRate: 98.8, contractsToday: 4, metric: '4 contracts processed today' },
  { name: 'Controller AI', status: 'green', lastExec: '1 min ago', successRate: 99.5, timesheetsToday: 12, metric: '12 timesheets processed' },
  { name: 'Cloud SQL', status: 'green', connections: 8, latency: 12, storage: 42, metric: '12ms latency, 42% storage' },
  { name: 'BigQuery', status: 'green', rowsToday: 14500, queryCost: 2.4, metric: '14.5K rows, $2.40 cost today' },
  { name: 'Cloud Storage', status: 'green', bucketSize: '2.1 GB', wormStatus: 'Locked', metric: 'WORM: Locked ✓' },
  { name: 'Pub/Sub', status: 'green', unacked: 0, subAge: '2s', metric: '0 unacked messages' },
  { name: 'Cloud Scheduler', status: 'amber', lastRun: 'Success', failedJobs: 1, metric: '1 job warning: PDPL purge slow' },
  { name: 'Zoho Books API', status: 'green', responseTime: 230, lastSuccess: '3 min ago', metric: '230ms response time' },
  { name: 'Zoho Payroll API', status: 'green', responseTime: 185, lastSuccess: '1 hr ago', metric: '185ms response time' },
]

export const notifications = [
  { id: 'n-001', priority: 'critical', title: 'Contract Expires in 5 Days', desc: 'Ahmed Al-Rashidi — MOH deployment', time: '07:00 AM', read: false },
  { id: 'n-002', priority: 'high', title: 'Invoice Ready for Approval', desc: 'INV-2026-047: SAR 48,000 — Emkan', time: '08:30 AM', read: false },
  { id: 'n-003', priority: 'high', title: 'Payroll Hold', desc: 'Omar Sultan has unapproved timesheet', time: '09:00 AM', read: false },
  { id: 'n-004', priority: 'normal', title: 'Resume Matched', desc: 'Khalid M. — 87% match for Java Engineer', time: '09:14 AM', read: true },
  { id: 'n-005', priority: 'normal', title: 'Timesheet Approved', desc: 'Mohammed Al-Fahad — PO-2024-018, 160hrs', time: '09:35 AM', read: true },
  { id: 'n-006', priority: 'low', title: 'PDPL Purge Complete', desc: '3 candidate records deleted', time: '03:00 AM', read: true },
  { id: 'n-007', priority: 'normal', title: 'Payment Received', desc: 'SAR 44,000 from STC — INV-2026-035', time: '10:00 AM', read: true },
  { id: 'n-008', priority: 'low', title: 'RFP Scraped', desc: 'Ministry of Finance — Data Analytics Platform', time: '10:05 AM', read: true },
]
