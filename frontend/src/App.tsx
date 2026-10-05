import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import HomeLayout from './layouts/HomeLayout'
import ProjectLayout from './layouts/ProjectLayout'
import AdminPage from './pages/AdminPage'
import BaselinesPage from './pages/BaselinesPage'
import DocumentBaselineView from './pages/DocumentBaselineView'
import DocumentView from './pages/DocumentView'
import GlossaryAdmin from './pages/GlossaryAdmin'
import GraphView from './pages/GraphView'
import Home from './pages/Home'
import IdeaPage from './pages/IdeaPage'
import ApplicabilityPage from './pages/ApplicabilityPage'
import ChangesPage from './pages/ChangesPage'
import LibraryReleasesPage from './pages/LibraryReleasesPage'
import ParametersAdmin from './pages/ParametersAdmin'
import ProjectDetail from './pages/ProjectDetail'
import ReviewDetailPage from './pages/ReviewDetailPage'
import ReviewsPage from './pages/ReviewsPage'
import RoadmapPage from './pages/RoadmapPage'
import SuggestionsPage from './pages/SuggestionsPage'
import TableView from './pages/TableView'
import TraceabilityMatrixPage from './pages/TraceabilityMatrix'
import WorkflowsAdmin from './pages/WorkflowsAdmin'

export default function App() {
  return (
    <Routes>
      <Route element={<HomeLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/glossary" element={<Navigate to="/glossary" replace />} />
        <Route path="/admin/:tab" element={<AdminPage />} />
        <Route path="/standards" element={<Navigate to="/admin/standards" replace />} />
        <Route path="/glossary" element={<GlossaryAdmin />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
        <Route path="/roadmap/ideas/:ideaId" element={<IdeaPage />} />
      </Route>

      <Route path="/projects/:projectId" element={<ProjectLayout />}>
        <Route index element={<ProjectDetail />} />
        <Route path="matrix" element={<TraceabilityMatrixPage />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="parameters" element={<ParametersAdmin />} />
        <Route path="baselines" element={<BaselinesPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="reviews/:reviewId" element={<ReviewDetailPage />} />
        <Route path="suggestions" element={<SuggestionsPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="workflows" element={<WorkflowsAdmin />} />
        <Route path="applicability" element={<ApplicabilityPage />} />
        <Route path="releases" element={<LibraryReleasesPage />} />
        <Route path="documents/:documentId" element={<DocumentView />} />
        <Route path="documents/:documentId/table" element={<TableView />} />
        <Route path="documents/:documentId/baselines/:baselineId" element={<DocumentBaselineView />} />
        {/* Old Document View address — the document view is now the default. */}
        <Route path="documents/:documentId/document" element={<ToDocumentRoot />} />
      </Route>
    </Routes>
  )
}

function ToDocumentRoot() {
  const location = useLocation()
  return <Navigate to={location.pathname.replace(/\/document$/, '') + location.search} replace />
}
