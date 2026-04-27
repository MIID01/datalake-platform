// Client Portal — Mock Data
// Each client sees only THEIR projects, engineers, timesheets, and invoices

export const clientProfile = {
  company: 'Emkan',
  contactName: 'Khalid Al-Dosari',
  title: 'VP Engineering',
  email: 'khalid.dosari@emkan.sa',
  phone: '+966 50 111 2233',
  logo: null,
}

export const clientProjects = [
  {
    id: 'PRJ-001',
    name: 'Core Banking Platform',
    status: 'Active',
    startDate: '2025-06-01',
    endDate: '2026-06-01',
    pos: [
      {
        number: 'PO-2024-018',
        description: 'Senior Java Engineer — Core Banking',
        totalHours: 2080,
        usedHours: 800,
        remainingHours: 1280,
        ratePerHour: 250,
        totalValue: 520000,
        invoiced: 200000,
        status: 'Active',
      },
      {
        number: 'PO-2024-022',
        description: 'DevOps Engineer — CI/CD Pipeline',
        totalHours: 1040,
        usedHours: 480,
        remainingHours: 560,
        ratePerHour: 230,
        totalValue: 239200,
        invoiced: 110400,
        status: 'Active',
      },
    ],
    engineers: [
      {
        id: 'EMP-001',
        name: 'Mohammed Al-Fahad',
        role: 'Senior Java Engineer',
        po: 'PO-2024-018',
        startDate: '2025-06-01',
        endDate: '2026-06-01',
        daysRemaining: 42,
        currentMonthHours: 136,
        attendance: 98,
        status: 'Active',
        skills: ['Java', 'Spring Boot', 'Microservices', 'PostgreSQL'],
      },
      {
        id: 'EMP-002',
        name: 'Fatimah Al-Harbi',
        role: 'DevOps Engineer',
        po: 'PO-2024-022',
        startDate: '2025-08-01',
        endDate: '2026-08-01',
        daysRemaining: 103,
        currentMonthHours: 144,
        attendance: 100,
        status: 'Active',
        skills: ['Kubernetes', 'Terraform', 'Jenkins', 'AWS', 'GCP'],
      },
    ],
  },
  {
    id: 'PRJ-004',
    name: 'Data Analytics Dashboard',
    status: 'Completed',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    pos: [
      {
        number: 'PO-2024-009',
        description: 'Data Engineer — Analytics Pipeline',
        totalHours: 1560,
        usedHours: 1560,
        remainingHours: 0,
        ratePerHour: 240,
        totalValue: 374400,
        invoiced: 374400,
        status: 'Completed',
      },
    ],
    engineers: [
      {
        id: 'EMP-007',
        name: 'Yusuf Al-Qahtani',
        role: 'Data Engineer',
        po: 'PO-2024-009',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        daysRemaining: 0,
        currentMonthHours: 0,
        attendance: 97,
        status: 'Offboarded',
        skills: ['Python', 'Spark', 'BigQuery', 'Airflow'],
      },
    ],
  },
]

export const clientTimesheets = [
  { id: 'cts-001', engineer: 'Mohammed Al-Fahad', role: 'Senior Java Engineer', po: 'PO-2024-018', period: 'Apr 1 — Apr 30, 2026', hours: 176, amount: 44000, status: 'Pending Approval', submittedDate: '2026-04-21' },
  { id: 'cts-002', engineer: 'Fatimah Al-Harbi', role: 'DevOps Engineer', po: 'PO-2024-022', period: 'Apr 1 — Apr 30, 2026', hours: 144, amount: 33120, status: 'Pending Approval', submittedDate: '2026-04-20' },
  { id: 'cts-003', engineer: 'Mohammed Al-Fahad', role: 'Senior Java Engineer', po: 'PO-2024-018', period: 'Mar 1 — Mar 31, 2026', hours: 168, amount: 42000, status: 'Approved', submittedDate: '2026-03-20', approvedDate: '2026-03-22' },
  { id: 'cts-004', engineer: 'Fatimah Al-Harbi', role: 'DevOps Engineer', po: 'PO-2024-022', period: 'Mar 1 — Mar 31, 2026', hours: 176, amount: 40480, status: 'Approved', submittedDate: '2026-03-19', approvedDate: '2026-03-21' },
  { id: 'cts-005', engineer: 'Mohammed Al-Fahad', role: 'Senior Java Engineer', po: 'PO-2024-018', period: 'Feb 1 — Feb 28, 2026', hours: 160, amount: 40000, status: 'Approved', submittedDate: '2026-02-20', approvedDate: '2026-02-22' },
  { id: 'cts-006', engineer: 'Fatimah Al-Harbi', role: 'DevOps Engineer', po: 'PO-2024-022', period: 'Feb 1 — Feb 28, 2026', hours: 152, amount: 34960, status: 'Approved', submittedDate: '2026-02-19', approvedDate: '2026-02-21' },
]

export const clientInvoices = [
  { id: 'INV-2026-047', period: 'March 2026', amount: 82480, status: 'Paid', issuedDate: '2026-03-25', dueDate: '2026-04-25', paidDate: '2026-04-10', pos: ['PO-2024-018', 'PO-2024-022'] },
  { id: 'INV-2026-038', period: 'February 2026', amount: 74960, status: 'Paid', issuedDate: '2026-02-25', dueDate: '2026-03-25', paidDate: '2026-03-12', pos: ['PO-2024-018', 'PO-2024-022'] },
  { id: 'INV-2026-029', period: 'January 2026', amount: 78200, status: 'Paid', issuedDate: '2026-01-25', dueDate: '2026-02-25', paidDate: '2026-02-15', pos: ['PO-2024-018', 'PO-2024-022'] },
  { id: 'INV-2026-052', period: 'April 2026', amount: 77120, status: 'Pending', issuedDate: null, dueDate: null, paidDate: null, pos: ['PO-2024-018', 'PO-2024-022'] },
]
