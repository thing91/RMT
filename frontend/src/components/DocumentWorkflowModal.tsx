import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useDocumentTransition, useProjectWorkflows } from '../api/collabHooks'
import type { BulkTransitionResult } from '../api/types'
import {
  useAssignWorkflowRole,
  useOrgUsers,
  useRevokeWorkflowRole,
  useWorkflowRoles,
} from '../api/hooks'

interface Props {
  documentId: string
  documentName: string
  orgId: string
  onClose: () => void
}

/** Assign reviewers/approvers for this document and trigger a whole-document
 * approval (§ user request — DOORS/Polarion-style sign-off, not in the
 * original brief). Reviewers/approvers here are workflow sign-off
 * authority, distinct from the project-wide RBAC "reviewer" role which only
 * gates read access. */
export default function DocumentWorkflowModal({ documentId, documentName, orgId, onClose }: Props) {
  const { data: roles } = useWorkflowRoles(documentId)
  const { data: users } = useOrgUsers(orgId)
  const assignRole = useAssignWorkflowRole(documentId)
  const revokeRole = useRevokeWorkflowRole()
  const { projectId } = useParams<{ projectId: string }>()
  const { data: workflows } = useProjectWorkflows(projectId)
  const bulk = useDocumentTransition(documentId)

  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<'reviewer' | 'approver'>('approver')
  const [error, setError] = useState<string | null>(null)

  const [transitionKey, setTransitionKey] = useState('approve')
  const [bulkComment, setBulkComment] = useState('')
  const [password, setPassword] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkTransitionResult | null>(null)
  const [confirmingBulk, setConfirmingBulk] = useState(false)

  // Every transition offered by any workflow in this project, de-duplicated
  // by key — the server applies it only to items where it's valid.
  const transitionOptions = useMemo(() => {
    const seen = new Map<string, { label: string; signature: boolean; comment: boolean }>()
    for (const w of workflows ?? []) {
      for (const t of w.transitions) {
        if (t.roles.length === 1 && t.roles[0] === 'system') continue
        if (!seen.has(t.key))
          seen.set(t.key, {
            label: t.label,
            signature: t.actions.some((a) => a.type === 'require_signature'),
            comment: t.requires_comment,
          })
      }
    }
    return [...seen.entries()]
  }, [workflows])
  const selected = transitionOptions.find(([k]) => k === transitionKey)?.[1]

  function assign() {
    if (!userId) return
    setError(null)
    assignRole.mutate(
      { user_id: userId, role },
      {
        onSuccess: () => setUserId(''),
        onError: (err) => setError(apiErrorMessage(err, 'Could not assign this role.')),
      },
    )
  }

  function runBulk() {
    setError(null)
    bulk.mutate(
      { key: transitionKey, input: { comment: bulkComment.trim() || undefined, password: password || undefined } },
      {
        onSuccess: (res) => {
          setBulkResult(res)
          setConfirmingBulk(false)
          setPassword('')
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not run this transition.')),
      },
    )
  }

  const reviewers = (roles ?? []).filter((r) => r.role === 'reviewer')
  const approvers = (roles ?? []).filter((r) => r.role === 'approver')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Workflow — {documentName}</h2>
          <button onClick={onClose} title="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <p className="mb-4 text-xs text-slate-500">
            Reviewers and approvers assigned here are notified when an item is submitted for
            review, and workflow transitions restricted to approvers (e.g. "Approve") can only be
            run by an assigned approver or a project admin.
          </p>

          <div className="mb-4 flex items-end gap-2 rounded-md bg-slate-50 p-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">User</label>
              <select
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">Select a user…</option>
                {(users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.username}){!u.email ? ' — no email on file' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Role</label>
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value as 'reviewer' | 'approver')}
              >
                <option value="approver">Approver</option>
                <option value="reviewer">Reviewer</option>
              </select>
            </div>
            <button
              onClick={assign}
              disabled={!userId || assignRole.isPending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Assign
            </button>
          </div>
          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Approvers
              </h3>
              <ul className="space-y-1">
                {approvers.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-md bg-white px-2 py-1 text-sm ring-1 ring-slate-200"
                  >
                    {r.display_name}
                    <button
                      onClick={() => revokeRole.mutate(r.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Revoke"
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {approvers.length === 0 && <li className="text-xs text-slate-400">None assigned yet.</li>}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reviewers
              </h3>
              <ul className="space-y-1">
                {reviewers.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-md bg-white px-2 py-1 text-sm ring-1 ring-slate-200"
                  >
                    {r.display_name}
                    <button
                      onClick={() => revokeRole.mutate(r.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Revoke"
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {reviewers.length === 0 && <li className="text-xs text-slate-400">None assigned yet.</li>}
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Run a transition on the whole document
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Applies the transition to every item in this document where it is currently possible (e.g. approve
              everything that is In Review). Each item is checked individually — roles, conditions and signatures
              still apply.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <select
                  className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  value={transitionKey}
                  onChange={(e) => setTransitionKey(e.target.value)}
                >
                  {transitionOptions.map(([key, t]) => (
                    <option key={key} value={key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  placeholder={selected?.comment ? 'Justification (required)…' : 'Comment (optional)…'}
                  value={bulkComment}
                  onChange={(e) => setBulkComment(e.target.value)}
                />
              </div>
              {selected?.signature && (
                <input
                  type="password"
                  className="w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-sm"
                  placeholder="Electronic signature — your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              {!confirmingBulk ? (
                <button
                  onClick={() => setConfirmingBulk(true)}
                  disabled={!selected || (selected.comment && !bulkComment.trim())}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {selected?.label ?? 'Run'} — all eligible items
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={runBulk}
                    disabled={bulk.isPending}
                    className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button onClick={() => setConfirmingBulk(false)} className="text-sm text-slate-400 hover:text-slate-700">
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {bulkResult && (
              <div className="mt-2 text-xs">
                <p className="text-green-700">
                  Done for {bulkResult.applied.length} item(s)
                  {bulkResult.applied.length > 0 && ': ' + bulkResult.applied.join(', ')}.
                </p>
                {bulkResult.skipped.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-amber-700">
                    {bulkResult.skipped.map((sk) => (
                      <li key={sk.item_id}>
                        {sk.key}: {sk.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
