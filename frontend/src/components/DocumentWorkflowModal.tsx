import { useState } from 'react'
import { apiErrorMessage } from '../api/client'
import {
  useApproveDocument,
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
  const approveDocument = useApproveDocument(documentId)

  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<'reviewer' | 'approver'>('approver')
  const [error, setError] = useState<string | null>(null)

  const [approveStatus, setApproveStatus] = useState('approved')
  const [approveNote, setApproveNote] = useState('')
  const [approveResult, setApproveResult] = useState<string | null>(null)
  const [confirmingApprove, setConfirmingApprove] = useState(false)

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

  function approveWholeDocument() {
    approveDocument.mutate(
      { status_value: approveStatus, note: approveNote.trim() || undefined },
      {
        onSuccess: (res) => {
          setApproveResult(`Approved ${res.approved_count} item(s); ${res.skipped_count} skipped (no matching status).`)
          setConfirmingApprove(false)
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not approve this document.')),
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
            Reviewers and approvers assigned here can be notified when an item is moved to "In
            Review", and only an assigned approver (or a project admin) can move an item to a
            status flagged as requiring approval — e.g. "Approved".
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
              Approve whole document
            </h3>
            <p className="mb-2 text-xs text-slate-500">
              Moves every content item whose type has a matching gated status straight to that
              status — the same as approving each one individually. Requires being an assigned
              approver (or project admin).
            </p>
            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                value={approveStatus}
                onChange={(e) => setApproveStatus(e.target.value)}
              >
                <option value="approved">Approved</option>
              </select>
              <input
                className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                placeholder="Optional note (included in the email)…"
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
              {!confirmingApprove ? (
                <button
                  onClick={() => setConfirmingApprove(true)}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Approve document
                </button>
              ) : (
                <>
                  <button
                    onClick={approveWholeDocument}
                    disabled={approveDocument.isPending}
                    className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmingApprove(false)}
                    className="text-sm text-slate-400 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
            {approveResult && <p className="mt-2 text-xs text-green-700">{approveResult}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
