import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import AuthGate from './components/AuthGate'
import ErrorBoundary from './components/ErrorBoundary'
import Consent from './pages/Consent'

// Layouts
import CEOLayout from './layouts/CEOLayout'
import EmployeeLayout from './layouts/EmployeeLayout'
import HRLayout from './layouts/HRLayout'
import CTOLayout from './layouts/CTOLayout'
import AdminLayout from './layouts/AdminLayout'

// IT Administration portal
import AdminCredentials from './pages/admin/Credentials'
import AdminAccess from './pages/admin/Access'
import AdminAuditLogs from './pages/admin/AuditLogs'
import AdminUsers from './pages/admin/Users'

// CEO Pages
import CEOCommandCenter from './pages/ceo/CommandCenter'
import CEOPipeline from './pages/ceo/Pipeline'
import CEOTalent from './pages/ceo/Talent'
import CEOFinance from './pages/ceo/Finance'
import CEOExpenses from './pages/ceo/CEOExpenses'
import CEOLeave from './pages/ceo/CEOLeave'
import CEOPayroll from './pages/ceo/CEOPayroll'
import CEOTickets from './pages/ceo/CEOTickets'
import CEOTraining from './pages/ceo/CEOTraining'
import GrcLibrary from './pages/ceo/GrcLibrary'
import CEOContracts from './pages/ceo/Contracts'
import CEOApprovals from './pages/ceo/Approvals'
import CEOCompliance from './pages/ceo/Compliance'
import CEOAnalytics from './pages/ceo/Analytics'
import CEOAlerts from './pages/ceo/Alerts'
import CEOSystem from './pages/ceo/SystemHealth'
import CEOAIOperations from './pages/ceo/AIOperations'
import CEOTaskInbox from './pages/ceo/TaskInbox'
import CEOProjects from './pages/ceo/Projects'
import CEOAdmin from './pages/ceo/Admin'
import CEOEmployees from './pages/ceo/CEOEmployees'

// CTO Pages
import CTODashboard from './pages/cto/Dashboard'
import CTOApprovals from './pages/cto/Approvals'
import CTOProjects from './pages/cto/Projects'

// Employee Pages
import EmpDashboard from './pages/employee/Dashboard'
import EmpTimesheets from './pages/employee/Timesheets'
import EmpLeave from './pages/employee/Leave'
import EmpExpenses from './pages/employee/Expenses'
import EmpDocuments from './pages/employee/Documents'
import EmpTravel from './pages/employee/Travel'
import EmpTraining from './pages/employee/Training'
import EmpSupport from './pages/employee/Support'
import EmpProfile from './pages/employee/Profile'
import EmployeeOnboarding from './pages/employee/Onboarding'

// HR Pages
import HRTalentPool from './pages/hr/HRTalentPool'
import HRScoring from './pages/hr/HRScoring'
import InterviewCVPrep from './pages/hr/InterviewCVPrep'
import HRJobListings from './pages/hr/HRJobListings'
import HREmployees from './pages/hr/HREmployees'

// Client Pages
import ClientTimesheetApproval from './pages/client/ClientDashboard'
import ClientScorecard from './pages/client/ClientScorecard'
import ContractAcceptance from './pages/client/ContractAcceptance'

import Careers from './pages/Careers'

export default function App() {
  return (
    <AuthGate>
      <ErrorBoundary>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* CEO Command Center */}
        <Route path="/ceo" element={<CEOLayout />}>
          <Route index element={<CEOCommandCenter />} />
          <Route path="pipeline" element={<CEOPipeline />} />
          <Route path="projects" element={<CEOProjects />} />
          <Route path="employees" element={<CEOEmployees />} />
          <Route path="talent" element={<CEOTalent />} />
          <Route path="finance" element={<CEOFinance />} />
          <Route path="expenses" element={<CEOExpenses />} />
          <Route path="leave" element={<CEOLeave />} />
          <Route path="payroll" element={<CEOPayroll />} />
          <Route path="tickets" element={<CEOTickets />} />
          <Route path="training" element={<CEOTraining />} />
          <Route path="policies" element={<GrcLibrary />} />
          <Route path="contracts" element={<CEOContracts />} />
          <Route path="approvals" element={<CEOApprovals />} />
          <Route path="compliance" element={<CEOCompliance />} />
          <Route path="analytics" element={<CEOAnalytics />} />
          <Route path="alerts" element={<CEOAlerts />} />
          <Route path="system" element={<CEOSystem />} />
          <Route path="ai-ops" element={<CEOAIOperations />} />
          <Route path="tasks" element={<CEOTaskInbox />} />
          <Route path="admin" element={<CEOAdmin />} />
        </Route>

        {/* CTO Portal */}
        <Route path="/cto" element={<CTOLayout />}>
          <Route index element={<CTODashboard />} />
          <Route path="approvals" element={<CTOApprovals />} />
          <Route path="projects" element={<CTOProjects />} />
        </Route>

        {/* IT Administration Portal (it_admin) — segregated from CEO /ceo/admin */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/credentials" replace />} />
          <Route path="credentials" element={<AdminCredentials />} />
          <Route path="access" element={<AdminAccess />} />
          <Route path="audit" element={<AdminAuditLogs />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="*" element={<Navigate to="/admin/credentials" replace />} />
        </Route>

        {/* Onboarding gate — full-screen, OUTSIDE the employee layout */}
        <Route path="/employee/onboarding" element={<EmployeeOnboarding />} />

        <Route path="/employee" element={<EmployeeLayout />}>
          <Route index element={<Navigate to="/employee/dashboard" replace />} />
          <Route path="dashboard" element={<EmpDashboard />} />
          <Route path="timesheets" element={<EmpTimesheets />} />
          <Route path="leave" element={<EmpLeave />} />
          <Route path="expenses" element={<EmpExpenses />} />
          <Route path="documents" element={<EmpDocuments />} />
          <Route path="travel" element={<EmpTravel />} />
          <Route path="training" element={<EmpTraining />} />
          <Route path="support" element={<EmpSupport />} />
          <Route path="profile" element={<EmpProfile />} />
          <Route path="*" element={<Navigate to="/employee/dashboard" replace />} />
        </Route>

        {/* Legacy /portal and /engineer redirect to /employee */}
        <Route path="/portal/*" element={<Navigate to="/employee" replace />} />
        <Route path="/engineer/*" element={<Navigate to="/employee" replace />} />

        {/* HR Portal */}
        <Route path="/hr" element={<HRLayout />}>
          <Route index element={<HRTalentPool />} />
          <Route path="employees" element={<HREmployees />} />
          <Route path="scoring" element={<HRScoring />} />
          <Route path="interview-cv" element={<InterviewCVPrep />} />
          <Route path="jobs" element={<HRJobListings />} />
        </Route>

        {/* Client Portal */}
        <Route path="/client" element={<ClientTimesheetApproval />} />
        <Route path="/client/timesheet/:token" element={<ClientTimesheetApproval />} />
        <Route path="/client/scorecard/:token" element={<ClientScorecard />} />
        <Route path="/contract/:token" element={<ContractAcceptance />} />

        {/* Public Pages */}
        <Route path="/careers" element={<Careers />} />
        <Route path="/consent/:token" element={<Consent />} />
      </Routes>
      </ErrorBoundary>
    </AuthGate>
  )
}
