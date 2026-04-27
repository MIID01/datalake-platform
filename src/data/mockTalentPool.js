// DTLK-OPS-TLP-001 — Talent Pool Mock Data
// 30 candidates distributed across 5 lifecycle states

const STATES = ['PENDING_CONSENT', 'ACTIVE_POOL_YEAR_1', 'ACTIVE_POOL_YEAR_2', 'RENEWAL_PENDING', 'GRACE_PERIOD']

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export const talentPoolCandidates = [
  // ── PENDING_CONSENT (5 records) — consent within last 30 days ──
  { id: 'TP-0101', name: '████████', nameVisible: false, source: 'LINKEDIN', state: 'PENDING_CONSENT', consentDate: null, receivedAt: daysAgo(3), daysInPool: 3, renewalDate: null, skills: ['Python', 'Spark', 'AWS'], expiresAt: daysAgo(-27) },
  { id: 'TP-0102', name: '████████', nameVisible: false, source: 'BAYT', state: 'PENDING_CONSENT', consentDate: null, receivedAt: daysAgo(12), daysInPool: 12, renewalDate: null, skills: ['Java', 'Spring Boot', 'Kubernetes'], expiresAt: daysAgo(-18) },
  { id: 'TP-0103', name: '████████', nameVisible: false, source: 'HR_EMAIL', state: 'PENDING_CONSENT', consentDate: null, receivedAt: daysAgo(18), daysInPool: 18, renewalDate: null, skills: ['React', 'TypeScript', 'Node.js'], expiresAt: daysAgo(-12) },
  { id: 'TP-0104', name: '████████', nameVisible: false, source: 'TUNISIA', state: 'PENDING_CONSENT', consentDate: null, receivedAt: daysAgo(25), daysInPool: 25, renewalDate: null, skills: ['DevOps', 'Terraform', 'GCP'], expiresAt: daysAgo(-5) },
  { id: 'TP-0105', name: '████████', nameVisible: false, source: 'FACEBOOK', state: 'PENDING_CONSENT', consentDate: null, receivedAt: daysAgo(8), daysInPool: 8, renewalDate: null, skills: ['Data Science', 'R', 'Tableau'], expiresAt: daysAgo(-22) },

  // ── ACTIVE_POOL_YEAR_1 (10 records) — consent 1-11 months ago ──
  { id: 'TP-0201', name: 'Khalid Al-Rashidi', nameVisible: true, source: 'WEBSITE', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(45), receivedAt: daysAgo(46), daysInPool: 45, renewalDate: null, skills: ['Python', 'TensorFlow', 'MLOps'] },
  { id: 'TP-0202', name: 'Nouf Al-Subaie', nameVisible: true, source: 'LINKEDIN', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(90), receivedAt: daysAgo(92), daysInPool: 90, renewalDate: null, skills: ['Go', 'Microservices', 'gRPC'] },
  { id: 'TP-0203', name: 'Faisal Al-Dosari', nameVisible: true, source: 'WEBSITE', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(120), receivedAt: daysAgo(122), daysInPool: 120, renewalDate: null, skills: ['React', 'Next.js', 'CSS'] },
  { id: 'TP-0204', name: 'Sara Al-Mutairi', nameVisible: true, source: 'NETWORK', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(150), receivedAt: daysAgo(152), daysInPool: 150, renewalDate: null, skills: ['Data Engineering', 'BigQuery', 'dbt'] },
  { id: 'TP-0205', name: 'Abdullah Al-Zahrani', nameVisible: true, source: 'BAYT', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(60), receivedAt: daysAgo(62), daysInPool: 60, renewalDate: null, skills: ['Java', 'PostgreSQL', 'Redis'] },
  { id: 'TP-0206', name: 'Lama Al-Otaibi', nameVisible: true, source: 'GULFTALENT', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(200), receivedAt: daysAgo(202), daysInPool: 200, renewalDate: null, skills: ['AWS', 'Lambda', 'DynamoDB'] },
  { id: 'TP-0207', name: 'Turki Al-Harbi', nameVisible: true, source: 'WEBSITE', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(75), receivedAt: daysAgo(76), daysInPool: 75, renewalDate: null, skills: ['Kubernetes', 'Docker', 'Helm'] },
  { id: 'TP-0208', name: 'Maha Al-Qahtani', nameVisible: true, source: 'LINKEDIN', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(180), receivedAt: daysAgo(182), daysInPool: 180, renewalDate: null, skills: ['Flutter', 'Dart', 'Firebase'] },
  { id: 'TP-0209', name: 'Yousef Al-Shehri', nameVisible: true, source: 'HR_EMAIL', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(30), receivedAt: daysAgo(32), daysInPool: 30, renewalDate: null, skills: ['Python', 'FastAPI', 'MongoDB'] },
  { id: 'TP-0210', name: 'Amal Al-Ghamdi', nameVisible: true, source: 'NETWORK', state: 'ACTIVE_POOL_YEAR_1', consentDate: daysAgo(240), receivedAt: daysAgo(242), daysInPool: 240, renewalDate: null, skills: ['Cybersecurity', 'SIEM', 'IAM'] },

  // ── ACTIVE_POOL_YEAR_2 (7 records) — renewed within last 12 months ──
  { id: 'TP-0301', name: 'Mohammed Al-Dossary', nameVisible: true, source: 'WEBSITE', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(400), receivedAt: daysAgo(402), daysInPool: 400, renewalDate: daysAgo(35), skills: ['Python', 'Spark', 'Airflow'] },
  { id: 'TP-0302', name: 'Hessa Al-Tamimi', nameVisible: true, source: 'LINKEDIN', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(380), receivedAt: daysAgo(382), daysInPool: 380, renewalDate: daysAgo(15), skills: ['React', 'GraphQL', 'TypeScript'] },
  { id: 'TP-0303', name: 'Bandar Al-Otaibi', nameVisible: true, source: 'BAYT', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(420), receivedAt: daysAgo(422), daysInPool: 420, renewalDate: daysAgo(60), skills: ['DevOps', 'Jenkins', 'AWS'] },
  { id: 'TP-0304', name: 'Dalal Al-Anazi', nameVisible: true, source: 'GULFTALENT', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(390), receivedAt: daysAgo(392), daysInPool: 390, renewalDate: daysAgo(28), skills: ['Data Science', 'PyTorch', 'NLP'] },
  { id: 'TP-0305', name: 'Nayef Al-Shamrani', nameVisible: true, source: 'WEBSITE', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(450), receivedAt: daysAgo(452), daysInPool: 450, renewalDate: daysAgo(90), skills: ['Go', 'PostgreSQL', 'Kafka'] },
  { id: 'TP-0306', name: 'Rawan Al-Harbi', nameVisible: true, source: 'HR_EMAIL', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(370), receivedAt: daysAgo(372), daysInPool: 370, renewalDate: daysAgo(8), skills: ['Angular', 'Java', 'Spring'] },
  { id: 'TP-0307', name: 'Sami Al-Mutlaq', nameVisible: true, source: 'NETWORK', state: 'ACTIVE_POOL_YEAR_2', consentDate: daysAgo(410), receivedAt: daysAgo(412), daysInPool: 410, renewalDate: daysAgo(50), skills: ['Cloud Security', 'Terraform', 'GCP'] },

  // ── RENEWAL_PENDING (5 records) — consent 11-12 months ago ──
  { id: 'TP-0401', name: 'Fahad Al-Qahtani', nameVisible: true, source: 'WEBSITE', state: 'RENEWAL_PENDING', consentDate: daysAgo(335), receivedAt: daysAgo(337), daysInPool: 335, renewalDate: null, renewalSentAt: daysAgo(5), skills: ['Python', 'BigQuery', 'Looker'] },
  { id: 'TP-0402', name: 'Areej Al-Mutairi', nameVisible: true, source: 'LINKEDIN', state: 'RENEWAL_PENDING', consentDate: daysAgo(340), receivedAt: daysAgo(342), daysInPool: 340, renewalDate: null, renewalSentAt: daysAgo(10), skills: ['UX Design', 'Figma', 'CSS'] },
  { id: 'TP-0403', name: 'Mansour Al-Johani', nameVisible: true, source: 'BAYT', state: 'RENEWAL_PENDING', consentDate: daysAgo(350), receivedAt: daysAgo(352), daysInPool: 350, renewalDate: null, renewalSentAt: daysAgo(20), skills: ['Java', 'Kafka', 'ElasticSearch'] },
  { id: 'TP-0404', name: 'Ghada Al-Shammari', nameVisible: true, source: 'HR_EMAIL', state: 'RENEWAL_PENDING', consentDate: daysAgo(345), receivedAt: daysAgo(347), daysInPool: 345, renewalDate: null, renewalSentAt: daysAgo(15), skills: ['iOS', 'Swift', 'Objective-C'] },
  { id: 'TP-0405', name: 'Omar Benali', nameVisible: true, source: 'TUNISIA', state: 'RENEWAL_PENDING', consentDate: daysAgo(330), receivedAt: daysAgo(332), daysInPool: 330, renewalDate: null, renewalSentAt: daysAgo(3), skills: ['PHP', 'Laravel', 'MySQL'] },

  // ── GRACE_PERIOD (3 records) — consent expired within last 30 days ──
  { id: 'TP-0501', name: 'Hassan Al-Dosari', nameVisible: true, source: 'LINKEDIN', state: 'GRACE_PERIOD', consentDate: daysAgo(395), receivedAt: daysAgo(397), daysInPool: 395, renewalDate: null, graceEndsAt: daysAgo(-8), skills: ['Python', 'Django', 'Redis'] },
  { id: 'TP-0502', name: 'Salwa Al-Rasheed', nameVisible: true, source: 'GULFTALENT', state: 'GRACE_PERIOD', consentDate: daysAgo(400), receivedAt: daysAgo(402), daysInPool: 400, renewalDate: null, graceEndsAt: daysAgo(-3), skills: ['Data Engineering', 'Spark', 'Hive'] },
  { id: 'TP-0503', name: 'Yassine Bouzid', nameVisible: true, source: 'TUNISIA', state: 'GRACE_PERIOD', consentDate: daysAgo(380), receivedAt: daysAgo(382), daysInPool: 380, renewalDate: null, graceEndsAt: daysAgo(-15), skills: ['React', 'Node.js', 'Docker'] },
]

export const talentPoolStats = {
  activePoolSize: 147,
  pendingConsent: 23,
  renewalsThisMonth: 12,
  purgedThisMonth: 8,
}

export const lifecycleDistribution = [
  { state: 'PENDING_CONSENT', label: 'Pending Consent', count: 23, color: '#8898aa' },
  { state: 'ACTIVE_POOL_YEAR_1', label: 'Active Year 1', count: 89, color: '#34BF3A' },
  { state: 'ACTIVE_POOL_YEAR_2', label: 'Active Year 2', count: 58, color: '#1598CC' },
  { state: 'RENEWAL_PENDING', label: 'Renewal Pending', count: 12, color: '#F39C12' },
  { state: 'GRACE_PERIOD', label: 'Grace Period', count: 5, color: '#EF5829' },
]

export const channelPerformance = [
  { channel: 'datalake.sa/careers', cvs: 34, consentRate: 100, quality: 72 },
  { channel: 'LinkedIn', cvs: 28, consentRate: 78, quality: 68 },
  { channel: 'Bayt', cvs: 18, consentRate: 65, quality: 55 },
  { channel: 'GulfTalent', cvs: 12, consentRate: 71, quality: 50 },
  { channel: 'HR Email', cvs: 15, consentRate: 82, quality: 74 },
  { channel: 'Tunisia Network', cvs: 8, consentRate: 45, quality: 40 },
  { channel: 'Facebook', cvs: 6, consentRate: 38, quality: 32 },
  { channel: 'Vendor Partners', cvs: 4, consentRate: 90, quality: 80 },
]

export const complianceAudit = {
  month: 'April 2026',
  generatedAt: 'Apr 1, 2026 07:00 AST',
  status: 'All Checks Passed',
  dsarResponseTime: '4.2 days avg',
  consentConversionRate: '76%',
  sensitiveDataViolations: 0,
}

export const STATE_COLORS = {
  PENDING_CONSENT: '#cbd5e1',
  ACTIVE_POOL_YEAR_1: '#4ade80',
  ACTIVE_POOL_YEAR_2: '#38bdf8',
  RENEWAL_PENDING: '#fbbf24',
  GRACE_PERIOD: '#fb923c',
}

export const STATE_LABELS = {
  PENDING_CONSENT: 'Pending Consent',
  ACTIVE_POOL_YEAR_1: 'Active Year 1',
  ACTIVE_POOL_YEAR_2: 'Active Year 2',
  RENEWAL_PENDING: 'Renewal Pending',
  GRACE_PERIOD: 'Grace Period',
}
