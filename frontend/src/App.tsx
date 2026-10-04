import { Route, Routes } from 'react-router-dom'
import HomeLayout from './layouts/HomeLayout'
import ProjectLayout from './layouts/ProjectLayout'
import DocumentView from './pages/DocumentView'
import GlossaryAdmin from './pages/GlossaryAdmin'
import GraphView from './pages/GraphView'
import Home from './pages/Home'
import ItemTypesAdmin from './pages/ItemTypesAdmin'
import LinkTypesAdmin from './pages/LinkTypesAdmin'
import ParametersAdmin from './pages/ParametersAdmin'
import ProjectDetail from './pages/ProjectDetail'
import StandardsAdmin from './pages/StandardsAdmin'
import TableView from './pages/TableView'
import TraceabilityMatrixPage from './pages/TraceabilityMatrix'
import TreeView from './pages/TreeView'

export default function App() {
  return (
    <Routes>
      <Route element={<HomeLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/admin/item-types" element={<ItemTypesAdmin />} />
        <Route path="/admin/link-types" element={<LinkTypesAdmin />} />
        <Route path="/glossary" element={<GlossaryAdmin />} />
        <Route path="/standards" element={<StandardsAdmin />} />
      </Route>

      <Route path="/projects/:projectId" element={<ProjectLayout />}>
        <Route index element={<ProjectDetail />} />
        <Route path="matrix" element={<TraceabilityMatrixPage />} />
        <Route path="graph" element={<GraphView />} />
        <Route path="parameters" element={<ParametersAdmin />} />
        <Route path="documents/:documentId" element={<TreeView />} />
        <Route path="documents/:documentId/table" element={<TableView />} />
        <Route path="documents/:documentId/document" element={<DocumentView />} />
      </Route>
    </Routes>
  )
}
