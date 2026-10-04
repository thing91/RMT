import { Route, Routes } from 'react-router-dom'
import HomeLayout from './layouts/HomeLayout'
import ProjectLayout from './layouts/ProjectLayout'
import DocumentView from './pages/DocumentView'
import GlossaryAdmin from './pages/GlossaryAdmin'
import GraphView from './pages/GraphView'
import Home from './pages/Home'
import IdeaPage from './pages/IdeaPage'
import ApplicabilityPage from './pages/ApplicabilityPage'
import ChangesPage from './pages/ChangesPage'
import ItemTypesAdmin from './pages/ItemTypesAdmin'
import LibraryReleasesPage from './pages/LibraryReleasesPage'
import LinkTypesAdmin from './pages/LinkTypesAdmin'
import ParametersAdmin from './pages/ParametersAdmin'
import ProjectDetail from './pages/ProjectDetail'
import ReviewDetailPage from './pages/ReviewDetailPage'
import ReviewsPage from './pages/ReviewsPage'
import RoadmapPage from './pages/RoadmapPage'
import StandardsAdmin from './pages/StandardsAdmin'
import SuggestionsPage from './pages/SuggestionsPage'
import TableView from './pages/TableView'
import TraceabilityMatrixPage from './pages/TraceabilityMatrix'
import TreeView from './pages/TreeView'
import WorkflowsAdmin from './pages/WorkflowsAdmin'

export default function App() {
  return (
    <Routes>
      <Route element={<HomeLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/admin/item-types" element={<ItemTypesAdmin />} />
        <Route path="/admin/link-types" element={<LinkTypesAdmin />} />
        <Route path="/admin/workflows" element={<WorkflowsAdmin />} />
        <Route path="/glossary" element={<GlossaryAdmin />} />
        <Route path="/standards" element={<StandardsAdmin />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
        <Route path="/roadmap/ideas/:ideaId" element={<IdeaPage />} />
      </Route>

      <Route path="/projects/:projectId" element={<ProjectLayout />}>
        <Route index element={<ProjectDetail />} />
        <Route path="matrix" element={<TraceabilityMatrixPage />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="parameters" element={<ParametersAdmin />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="reviews/:reviewId" element={<ReviewDetailPage />} />
        <Route path="suggestions" element={<SuggestionsPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="workflows" element={<WorkflowsAdmin />} />
        <Route path="applicability" element={<ApplicabilityPage />} />
        <Route path="releases" element={<LibraryReleasesPage />} />
        <Route path="documents/:documentId" element={<TreeView />} />
        <Route path="documents/:documentId/table" element={<TableView />} />
        <Route path="documents/:documentId/document" element={<DocumentView />} />
      </Route>
    </Routes>
  )
}
