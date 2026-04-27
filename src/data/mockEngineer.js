// Engineer Self-Service Portal — Mock Data

export const engineerProfile = {
  name: 'Mohammed Al-Fahad',
  employeeId: 'EMP-001',
  email: 'mohammed.alfahad@datalake.sa',
  phone: '+966 55 123 4567',
  nationality: 'Saudi',
  client: 'Emkan',
  role: 'Senior Java Engineer',
  contractStart: '2025-06-01',
  contractEnd: '2026-06-01',
  contractType: 'Full-Time Deployment',
  poNumber: 'PO-2024-018',
  baseSalary: 'SAR ••••••',
  bankName: 'Al Rajhi Bank ••••',
  gosiNumber: 'GOSI-••••-1234',
  emergencyContact: { name: 'Fahad Al-Fahad', relationship: 'Father', phone: '+966 55 987 6543' },
  skills: ['Java', 'Spring Boot', 'Microservices', 'AWS', 'Docker', 'PostgreSQL'],
  certifications: ['AWS Solutions Architect', 'Oracle Java SE 17'],
}

// ── Projects / Engagements ─────────────────────────────────
// Each project has a client approver who must sign-off timesheets
// before they reach CEO for final approval + invoicing
export const projects = [
  {
    id: 'PRJ-001',
    name: 'Emkan — Core Banking Platform',
    client: {
      name: 'Emkan',
      email: 'operations@emkan.sa',
      approver: {
        name: 'Khalid Al-Dosari',
        title: 'VP Engineering',
        email: 'khalid.dosari@emkan.sa',
        phone: '+966 50 111 2233',
      },
    },
    po: {
      number: 'PO-2024-018',
      totalHours: 2080,
      usedHours: 800,
      remainingHours: 1280,
      ratePerHour: 250, // SAR
      startDate: '2025-06-01',
      endDate: '2026-06-01',
    },
    status: 'Active',
    engineers: ['EMP-001'],
  },
  {
    id: 'PRJ-002',
    name: 'NEOM — Data Lakehouse',
    client: {
      name: 'NEOM',
      email: 'procurement@neom.com',
      approver: {
        name: 'Sarah Al-Mutairi',
        title: 'Program Director',
        email: 'sarah.mutairi@neom.com',
        phone: '+966 50 444 5566',
      },
    },
    po: {
      number: 'PO-2025-003',
      totalHours: 3120,
      usedHours: 240,
      remainingHours: 2880,
      ratePerHour: 300,
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    },
    status: 'Active',
    engineers: ['EMP-003', 'EMP-004'],
  },
  {
    id: 'PRJ-003',
    name: 'MOH — Cloud Migration',
    client: {
      name: 'Ministry of Health',
      email: 'it-procurement@moh.gov.sa',
      approver: {
        name: 'Omar Al-Shahrani',
        title: 'IT Director',
        email: 'omar.shahrani@moh.gov.sa',
        phone: '+966 50 777 8899',
      },
    },
    po: {
      number: 'PO-2025-007',
      totalHours: 1560,
      usedHours: 0,
      remainingHours: 1560,
      ratePerHour: 275,
      startDate: '2026-04-01',
      endDate: '2026-12-31',
    },
    status: 'Active',
    engineers: ['EMP-005', 'EMP-006'],
  },
]

export const dashboardStats = {
  contractDaysRemaining: { value: 42, endDate: '2026-06-01' },
  leaveBalance: { value: 8, total: 21 },
  pendingTimesheets: { value: 1, period: 'Apr 16 — Apr 30' },
  openTickets: { value: 0, lastUpdate: null },
}

export const upcomingActions = [
  { id: 'ua-001', type: 'timesheet', icon: '⏱️', title: 'Submit timesheet for Apr 16-30', due: '2026-04-30', urgency: 'warning' },
  { id: 'ua-002', type: 'document', icon: '📄', title: 'Sign: Updated Acceptable Use Policy v2.1', due: '2026-04-25', urgency: 'urgent' },
  { id: 'ua-003', type: 'training', icon: '🏫', title: 'Complete: Annual Ethics & Compliance Module', due: '2026-05-15', urgency: 'info' },
  { id: 'ua-004', type: 'contract', icon: '📋', title: 'Contract renewal discussion — 42 days remaining', due: '2026-06-01', urgency: 'info' },
]

export const timesheets = [
  { id: 'ts-001', period: 'Apr 1 — Apr 15', client: 'Emkan', po: 'PO-2024-018', hours: 80, status: 'Approved' },
  { id: 'ts-002', period: 'Mar 16 — Mar 31', client: 'Emkan', po: 'PO-2024-018', hours: 80, status: 'Approved' },
  { id: 'ts-003', period: 'Mar 1 — Mar 15', client: 'Emkan', po: 'PO-2024-018', hours: 72, status: 'Approved' },
  { id: 'ts-004', period: 'Feb 16 — Feb 28', client: 'Emkan', po: 'PO-2024-018', hours: 80, status: 'Approved' },
  { id: 'ts-005', period: 'Feb 1 — Feb 15', client: 'Emkan', po: 'PO-2024-018', hours: 80, status: 'Approved' },
  { id: 'ts-006', period: 'Apr 16 — Apr 30', client: 'Emkan', po: 'PO-2024-018', hours: 0, status: 'Draft' },
]

export const leaveData = {
  balances: [
    { type: 'Annual Leave', remaining: 8, total: 21, color: '#2C5F7C' },
    { type: 'Sick Leave', remaining: 15, total: 15, color: '#27AE60' },
    { type: 'Unpaid Leave', remaining: 30, total: 30, color: '#E8913A' },
    { type: 'Emergency', remaining: 3, total: 3, color: '#C0392B' },
  ],
  requests: [
    { id: 'lv-001', type: 'Annual Leave', start: '2026-03-10', end: '2026-03-12', days: 3, status: 'Approved', reason: 'Family event in Jeddah' },
    { id: 'lv-002', type: 'Sick Leave', start: '2026-02-20', end: '2026-02-20', days: 1, status: 'Approved', reason: 'Medical appointment' },
    { id: 'lv-003', type: 'Annual Leave', start: '2026-05-05', end: '2026-05-08', days: 4, status: 'Pending', reason: 'Personal travel to Dubai' },
  ],
  holidays: [
    { name: 'Eid Al-Fitr', start: '2026-03-31', end: '2026-04-04' },
    { name: 'Founding Day', date: '2026-02-22' },
    { name: 'Saudi National Day', date: '2026-09-23' },
    { name: 'Eid Al-Adha (Expected)', start: '2026-06-06', end: '2026-06-10' },
  ],
}

export const expenses = [
  { id: 'exp-001', date: '2026-04-15', category: 'Transportation', description: 'Uber to Emkan office (client meeting)', amount: 85, status: 'Submitted', receipt: true },
  { id: 'exp-002', date: '2026-04-10', category: 'Meals', description: 'Team lunch with Emkan developers', amount: 320, status: 'Approved', receipt: true },
  { id: 'exp-003', date: '2026-03-22', category: 'Training', description: 'AWS certification exam fee', amount: 450, status: 'Reimbursed', receipt: true },
  { id: 'exp-004', date: '2026-03-15', category: 'Office Supplies', description: 'External monitor stand', amount: 180, status: 'Reimbursed', receipt: true },
  { id: 'exp-005', date: '2026-04-18', category: 'Communication', description: 'Monthly mobile data plan', amount: 150, status: 'Draft', receipt: false },
]

export const documents = {
  employment: [
    { id: 'doc-001', name: 'Employment Contract', date: '2025-06-01', type: 'PDF', signed: true, action: null },
    { id: 'doc-002', name: 'Non-Disclosure Agreement', date: '2025-06-01', type: 'PDF', signed: true, action: null },
    { id: 'doc-003', name: 'Acceptable Use Policy v2.1', date: '2026-04-15', type: 'PDF', signed: false, action: 'Sign Required' },
  ],
  payslips: [
    { id: 'doc-004', name: 'Payslip — April 2026', date: '2026-04-25', type: 'PDF' },
    { id: 'doc-005', name: 'Payslip — March 2026', date: '2026-03-25', type: 'PDF' },
    { id: 'doc-006', name: 'Payslip — February 2026', date: '2026-02-25', type: 'PDF' },
  ],
  taxGosi: [
    { id: 'doc-007', name: 'GOSI Certificate 2026', date: '2026-01-15', type: 'PDF' },
  ],
  policies: [
    { id: 'doc-008', name: 'Information Security Policy', date: '2025-06-01', acknowledged: true },
    { id: 'doc-009', name: 'Code of Conduct', date: '2025-06-01', acknowledged: true },
    { id: 'doc-010', name: 'PDPL Privacy Policy', date: '2025-06-01', acknowledged: true },
    { id: 'doc-011', name: 'BCDR Plan', date: '2025-06-01', acknowledged: true },
  ],
  training: [
    { id: 'doc-012', name: 'AWS Solutions Architect Certificate', date: '2025-08-15', type: 'PDF' },
  ],
}

export const travelData = {
  visa: { type: 'Work Visa', applicationDate: '2025-05-01', expiryDate: '2027-05-01', status: 'Approved' },
  flight: { outbound: '2025-05-28', returnFlight: null, airline: 'Saudi Airlines', bookingRef: 'SV-78234', status: 'Completed' },
  housing: { address: 'King Abdullah District, Riyadh', leaseStart: '2025-06-01', leaseEnd: '2026-06-01', status: 'Active' },
  iqama: { number: 'IQ-••••-5678', expiryDate: '2027-05-01', renewalStatus: 'Valid' },
}

export const trainingModules = [
  { id: 'trn-001', title: 'Ethics and Compliance', description: 'Annual ethics training covering anti-bribery, code of conduct, and whistleblower policies', dueDate: '2026-05-15', status: 'Not Started', mandatory: true, frequency: 'Annual' },
  { id: 'trn-002', title: 'Data Privacy (PDPL)', description: 'Saudi Personal Data Protection Law requirements and best practices', dueDate: '2026-05-15', status: 'Not Started', mandatory: true, frequency: 'Annual' },
  { id: 'trn-003', title: 'Information Security (NCA)', description: 'NCA ECC-1:2018 security awareness and controls', dueDate: '2026-06-01', status: 'Not Started', mandatory: true, frequency: 'Annual' },
  { id: 'trn-004', title: 'Anti-Bribery and Corruption', description: 'ABC compliance program and reporting obligations', dueDate: '2026-06-01', status: 'Completed', mandatory: true, frequency: 'Annual', completedDate: '2026-02-15', score: 92 },
  { id: 'trn-005', title: 'Client Onboarding: Emkan', description: 'Emkan project standards, tools, and communication protocols', dueDate: '2025-06-15', status: 'Completed', mandatory: true, frequency: 'Per contract', completedDate: '2025-06-10', score: 100 },
  { id: 'trn-006', title: 'GCP Security Best Practices', description: 'Google Cloud Platform security configurations and IAM', dueDate: null, status: 'In Progress', mandatory: false, frequency: 'Optional', progress: 65 },
]

export const supportTickets = [
  {
    id: 'TKT-2026-015', category: 'IT / Access Issues', subject: 'Cannot access Emkan Jira board', priority: 'High',
    status: 'Resolved', created: '2026-04-10T09:00:00', resolved: '2026-04-10T11:30:00',
    slaHours: 4, slaUsed: 2.5,
    thread: [
      { sender: 'user', text: 'I lost access to the Emkan Jira board this morning. Getting 403 Forbidden error.', time: '09:00 AM' },
      { sender: 'system', text: 'Ticket triaged by Gatekeeper AI. Checking IAM permissions for Emkan project resources.', time: '09:02 AM' },
      { sender: 'system', text: 'Issue identified: IAM role binding expired during nightly rotation. Re-provisioning access now.', time: '09:15 AM' },
      { sender: 'system', text: 'Access restored. Please try again and confirm.', time: '09:20 AM' },
      { sender: 'user', text: 'Confirmed, I can access Jira again. Thanks!', time: '09:25 AM' },
    ],
  },
  {
    id: 'TKT-2026-012', category: 'Payroll / Salary', subject: 'March payslip shows incorrect overtime', priority: 'Medium',
    status: 'Closed', created: '2026-03-28T14:00:00', resolved: '2026-04-01T10:00:00',
    slaHours: 24, slaUsed: 20,
    thread: [
      { sender: 'user', text: 'My March payslip shows 8 hours of overtime but I logged 16 hours. PO-2024-018 timesheet shows correct hours.', time: '02:00 PM' },
      { sender: 'system', text: 'Escalated to Controller AI for Zoho Payroll reconciliation.', time: '02:05 PM' },
      { sender: 'system', text: 'Discrepancy confirmed. Controller AI corrected Zoho Payroll entry. Updated payslip will be available by April 1.', time: '04:30 PM' },
      { sender: 'user', text: 'Received corrected payslip. Issue resolved.', time: '10:00 AM, Apr 1' },
    ],
  },
]

export const engineerNotifications = [
  { id: 'en-001', type: 'document', title: 'Action Required: Sign Acceptable Use Policy v2.1', time: '2 hours ago', read: false, priority: 'high' },
  { id: 'en-002', type: 'timesheet', title: 'Timesheet Approved: Apr 1-15', time: '1 day ago', read: true, priority: 'normal' },
  { id: 'en-003', type: 'payslip', title: 'Payslip Available: April 2026', time: '2 days ago', read: true, priority: 'normal' },
  { id: 'en-004', type: 'expense', title: 'Expense Reimbursed: SAR 450', time: '3 days ago', read: true, priority: 'normal' },
  { id: 'en-005', type: 'training', title: 'Training Due: Ethics & Compliance Module', time: '5 days ago', read: false, priority: 'high' },
  { id: 'en-006', type: 'contract', title: 'Contract Reminder: 42 days remaining', time: '1 week ago', read: true, priority: 'normal' },
]
