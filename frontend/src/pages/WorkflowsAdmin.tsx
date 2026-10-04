import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  can,
  useDeleteProjectWorkflow,
  useOrgWorkflows,
  usePermissions,
  useProjectWorkflows,
  useSaveWorkflow,
} from '../api/collabHooks'
import { useItemTypes, useOrg } from '../api/hooks'
import WorkflowEditor from '../components/collab/WorkflowEditor'
import { btn } from '../components/collab/Modal'

/** Org-wide workflows per content item type (at /admin/workflows), or a
 * project's effective workflows with per-project overrides (at
 * /projects/:id/workflows). */
export default function WorkflowsAdmin() {
  const { projectId } = useParams<{ projectId?: string }>()
  const { org } = useOrg()
  const { data: itemTypes } = useItemTypes(org?.id)
  const { data: perms } = usePermissions(projectId)
  const { data: orgWorkflows } = useOrgWorkflows(org?.id)
  const { data: projectWorkflows } = useProjectWorkflows(projectId)
  const saveWorkflow = useSaveWorkflow()
  const removeOverride = useDeleteProjectWorkflow()
  const contentTypes = (itemTypes ?? []).filter((t) => t.behavior === 'content')
  const [selected, setSelected] = useState<string | null>(null)
  const active = selected ?? contentTypes[0]?.id ?? null

  const definitions = projectId ? projectWorkflows : orgWorkflows
  const definition = definitions?.find((d) => d.item_type_id === active)
  const canEdit = projectId ? can(perms, 'workflow.configure') : can(perms, 'workflow.configure_org')

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-lg font-semibold text-slate-800">
        {projectId ? 'Project workflows' : 'Workflows'}
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        {projectId
          ? 'The workflow each item type follows in this project. Override one to differ from the organization default.'
          : 'Organization-wide default workflow per item type. Projects can override them. Reference templates: Basic, Change-managed (default) and Regulated (signatures, separation of duties, test-linked verification).'}
      </p>
      {!canEdit && (
        <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
          Read-only — changing {projectId ? 'project' : 'organization'} workflows requires the{' '}
          {projectId ? 'workflow.configure' : 'organization admin'} permission.
        </p>
      )}
      <div className="flex gap-4">
        <nav className="w-48 shrink-0 space-y-0.5">
          {contentTypes.map((t) => {
            const d = definitions?.find((x) => x.item_type_id === t.id)
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t.id)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm ${
                  active === t.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.name}
                <span className="block text-[11px] text-slate-400">
                  {d ? d.name : 'no workflow'}
                  {d?.is_override && ' · project override'}
                </span>
              </button>
            )
          })}
        </nav>
        <section className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-4">
          {active && (
            <WorkflowEditor
              key={`${active}-${definition?.id ?? 'none'}`}
              definition={definition}
              canEdit={canEdit}
              onSave={(spec) => saveWorkflow.mutateAsync({ itemTypeId: active, projectId, spec })}
              extraActions={
                projectId && definition?.is_override ? (
                  <button
                    className={btn.ghost}
                    onClick={() => removeOverride.mutate({ itemTypeId: active, projectId })}
                  >
                    Remove override (use org default)
                  </button>
                ) : null
              }
            />
          )}
          {!definition && <p className="text-sm text-slate-400">This item type has no workflow yet.</p>}
        </section>
      </div>
    </div>
  )
}
