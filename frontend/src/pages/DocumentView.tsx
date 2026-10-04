import { useParams } from 'react-router-dom'
import { useOrg } from '../api/hooks'
import DocumentReviewView from '../components/DocumentReviewView'

export default function DocumentView() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId: string }>()
  const { org } = useOrg()

  if (!projectId || !documentId || !org) return null

  return <DocumentReviewView documentId={documentId} projectId={projectId} orgId={org.id} />
}
