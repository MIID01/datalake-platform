import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import CEOLayout from './layouts/CEOLayout'
import EngineerLayout from './layouts/EngineerLayout'
// Client Portal — single standalone page (no layout wrapper)
import CEOCommandCenter from './pages/ceo/CommandCenter'
import CEOPipeline from './pages/ceo/Pipeline'
import CEOTalent from './pages/ceo/Talent'
import CEOFinance from './pages/ceo/Finance'
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
import CTOLayout from './layouts/CTOLayout'
import CTODashboard from './pages/cto/Dashboard'
import CTOApprovals from './pages/cto/Approvals'
import CTOProjects from './pages/cto/Projects'
import EngDashboard from './pages/engineer/Dashboard'
import EngTimesheets from './pages/engineer/Timesheets'
import EngLeave from './pages/engineer/Leave'
import EngExpenses from './pages/engineer/Expenses'
import EngDocuments from './pages/engineer/Documents'
import EngTravel from './pages/engineer/Travel'
import EngTraining from './pages/engineer/Training'
import EngSupport from './pages/engineer/Support'
import EngProfile from './pages/engineer/Profile'
import ClientTimesheetApproval from './pages/client/ClientDashboard'
import HRScoring from './pages/hr/HRScoring'
import Careers from './pages/Careers'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      {/* CEO Command Center */}
      <Route path="/ceo" element={<CEOLayout />}>
        <Route index element={<CEOCommandCenter />} />
        <Route path="pipeline" element={<CEOPipeline />} />
        <Route path="projects" element={<CEOProjects />} />
        <Route path="talent" element={<CEOTalent />} />
        <Route path="finance" element={<CEOFinance />} />
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

      {/* Engineer Self-Service Portal */}
      <Route path="/portal" element={<EngineerLayout />}>
        <Route index element={<EngDashboard />} />
        <Route path="timesheets" element={<EngTimesheets />} />
        <Route path="leave" element={<EngLeave />} />
        <Route path="expenses" element={<EngExpenses />} />
        <Route path="documents" element={<EngDocuments />} />
        <Route path="travel" element={<EngTravel />} />
        <Route path="training" element={<EngTraining />} />
        <Route path="support" element={<EngSupport />} />
        <Route path="profile" element={<EngProfile />} />
      </Route>

      {/* Client Portal — Single page, no sidebar */}
      <Route path="/client" element={<ClientTimesheetApproval />} />

      {/* HR Interview Scoring — Single page (hr.datalake.sa) */}
      <Route path="/hr" element={<HRScoring />} />

      {/* Public Careers Page (datalake.sa/careers) */}
      <Route path="/careers" element={<Careers />} />
    </Routes>
  )
}
