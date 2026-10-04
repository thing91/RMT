import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import {
  useCreateMatrixView,
  useDeleteMatrixView,
  useItemTypes,
  useLinkTypes,
  useMatrixViews,
  useOrg,
  useTraceabilityMatrix,
} from '../api/hooks'

export default function TraceabilityMatrixPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { org } = useOrg()
  const orgId = org?.id
  const { data: itemTypes } = useItemTypes(orgId)
  const { data: linkTypes } = useLinkTypes(orgId)
  const { data: views } = useMatrixViews(projectId)
  const createView = useCreateMatrixView(projectId ?? '')
  const deleteView = useDeleteMatrixView()
  const contentTypes = (itemTypes ?? []).filter((t) => t.behavior === 'content')

  const [rowTypeId, setRowTypeId] = useState('')
  const [colTypeId, setColTypeId] = useState('')
  const [linkTypeId, setLinkTypeId] = useState('')
  const [viewId, setViewId] = useState('')
  const [newViewName, setNewViewName] = useState<string | null>(null)
  const [newViewScope, setNewViewScope] = useState<'personal' | 'shared'>('shared')
  const [error, setError] = useState<string | null>(null)

  const { data: matrix, isLoading } = useTraceabilityMatrix(
    projectId,
    rowTypeId || undefined,
    colTypeId || undefined,
    linkTypeId || undefined,
  )

  const cellLookup = new Map(
    (matrix?.cells ?? []).map((c) => [`${c.row_id}:${c.col_id}`, c.link_ids.length]),
  )
  const uncovered = new Set(matrix?.uncovered_row_ids ?? [])

  function applyView(id: string) {
    setViewId(id)
    const v = (views ?? []).find((mv) => mv.id === id)
    if (v) {
      setRowTypeId(v.row_type_id)
      setColTypeId(v.col_type_id)
      setLinkTypeId(v.link_type_id)
    }
  }

  function saveAsNew(name: string, scope: 'personal' | 'shared') {
    if (!name.trim() || !rowTypeId || !colTypeId || !linkTypeId) return
    setError(null)
    createView.mutate(
      { name: name.trim(), scope, row_type_id: rowTypeId, col_type_id: colTypeId, link_type_id: linkTypeId },
      {
        onSuccess: (v) => {
          setViewId(v.id)
          setNewViewName(null)
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not save this view.')),
      },
    )
  }

  const activeView = (views ?? []).find((v) => v.id === viewId)
  const isDirty =
    !!rowTypeId &&
    !!colTypeId &&
    !!linkTypeId &&
    (!activeView ||
      activeView.row_type_id !== rowTypeId ||
      activeView.col_type_id !== colTypeId ||
      activeView.link_type_id !== linkTypeId)

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Traceability Matrix</h1>
        {views && views.length > 0 && (
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={viewId}
            onChange={(e) => applyView(e.target.value)}
          >
            <option value="">Custom selection…</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Rows</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={rowTypeId}
            onChange={(e) => {
              setRowTypeId(e.target.value)
              setViewId('')
            }}
          >
            <option value="">Select type…</option>
            {contentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Columns</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={colTypeId}
            onChange={(e) => {
              setColTypeId(e.target.value)
              setViewId('')
            }}
          >
            <option value="">Select type…</option>
            {contentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Via link type</label>
          <select
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={linkTypeId}
            onChange={(e) => {
              setLinkTypeId(e.target.value)
              setViewId('')
            }}
          >
            <option value="">Select link type…</option>
            {(linkTypes ?? []).map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </select>
        </div>

        {isDirty && newViewName === null && (
          <button
            onClick={() => setNewViewName('')}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Save as view
          </button>
        )}
        {activeView && (
          <button
            onClick={() => {
              deleteView.mutate(activeView.id)
              setViewId('')
            }}
            className="text-sm text-slate-400 hover:text-red-600"
          >
            Delete view
          </button>
        )}
      </div>

      {newViewName !== null && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            saveAsNew(newViewName, newViewScope)
          }}
          className="mb-4 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-2"
        >
          <input
            autoFocus
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            placeholder="View name (e.g. Req ↔ VA coverage)…"
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
          />
          <select
            className="rounded-md border border-slate-300 px-1.5 py-1 text-sm"
            value={newViewScope}
            onChange={(e) => setNewViewScope(e.target.value as 'personal' | 'shared')}
            title="Shared views are visible to everyone on the project; personal views are just for you"
          >
            <option value="shared">Shared</option>
            <option value="personal">Personal</option>
          </select>
          <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
            Save
          </button>
          <button type="button" onClick={() => setNewViewName(null)} className="text-sm text-slate-400 hover:text-slate-700">
            Cancel
          </button>
        </form>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {!rowTypeId || !colTypeId || !linkTypeId ? (
        <p className="text-sm text-slate-400">
          Pick a row type, column type, and link type to see coverage.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !matrix || matrix.rows.length === 0 || matrix.cols.length === 0 ? (
        <p className="text-sm text-slate-400">No items of the selected types yet.</p>
      ) : (
        <>
          {uncovered.size > 0 && (
            <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              ⚠ {uncovered.size} item{uncovered.size === 1 ? '' : 's'} with no coverage
            </div>
          )}
          <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">
                    &nbsp;
                  </th>
                  {matrix.cols.map((col) => (
                    <th
                      key={col.id}
                      className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-mono text-xs text-slate-500"
                      title={col.title}
                    >
                      {col.key ?? col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.id} className={uncovered.has(row.id) ? 'bg-amber-50/40' : ''}>
                    <th
                      className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-left font-mono text-xs text-slate-500"
                      title={row.title}
                    >
                      {row.key ?? row.title}
                    </th>
                    {matrix.cols.map((col) => {
                      const count = cellLookup.get(`${row.id}:${col.id}`) ?? 0
                      return (
                        <td
                          key={col.id}
                          className="border-b border-slate-100 px-3 py-2 text-center"
                        >
                          {count > 0 ? (
                            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                          ) : (
                            <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-200" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
