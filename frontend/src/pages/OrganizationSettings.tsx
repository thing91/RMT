import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../api/client'
import { can, usePermissions } from '../api/collabHooks'
import { useOrg } from '../api/hooks'
import { btn } from '../components/collab/Modal'

interface OrgSettings {
  values: Record<string, number | boolean>
  defaults: Record<string, number | boolean>
}

interface RolePermissions {
  role: string
  defaults: string[]
  effective: string[]
}

const PERMISSION_INFO: Record<string, string> = {
  'item.edit': 'Edit requirement content',
  'structure.edit': 'Reorder / move / delete items',
  'workflow.transition': 'Run ordinary workflow transitions',
  'review.manage': 'Create and close reviews',
  'baseline.create': 'Create baselines',
  'audit.read': 'Read the audit log',
  'lock.override': "Release / take over someone else's edit lock",
  'suggestion.resolve': 'Accept / reject change suggestions',
  'applicability.decide': 'Decide applicability of library requirements',
  'applicability.approve': 'Approve "Not applicable" decisions',
  'workflow.configure': 'Override workflows in a project',
  'project.admin': 'Administer the project (access, settings)',
  'org.admin': 'Organization admin',
  'roadmap.manage': 'Product team: manage the roadmap',
  'library.release': 'Release generic requirement libraries',
  'workflow.configure_org': 'Change organization workflows',
}
const PROJECT_PERMS = Object.keys(PERMISSION_INFO).slice(0, 12)
const ORG_PERMS = ['roadmap.manage', 'library.release', 'workflow.configure_org']
const ROLES = ['viewer', 'reviewer', 'editor', 'admin']

export default function OrganizationSettings() {
  const { org } = useOrg()
  const { data: perms } = usePermissions()
  const isAdmin = can(perms, 'org.admin')
  const qc = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: ['org-settings', org?.id],
    queryFn: async () => (await api.get<OrgSettings>(`/organizations/${org!.id}/settings`)).data,
    enabled: !!org,
  })
  const { data: roles } = useQuery({
    queryKey: ['role-permissions', org?.id],
    queryFn: async () => (await api.get<RolePermissions[]>(`/organizations/${org!.id}/role-permissions`)).data,
    enabled: !!org,
  })
  const saveSettings = useMutation({
    mutationFn: async (values: Record<string, unknown>) =>
      (await api.put<OrgSettings>(`/organizations/${org!.id}/settings`, values)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-settings'] }),
  })
  const setPermission = useMutation({
    mutationFn: async (body: { role: string; permission: string; granted: boolean | null }) =>
      (await api.put<RolePermissions[]>(`/organizations/${org!.id}/role-permissions`, body)).data,
    onSuccess: (data) => {
      qc.setQueryData(['role-permissions', org?.id], data)
      qc.invalidateQueries({ queryKey: ['permissions'] })
    },
  })
  const [draft, setDraft] = useState<Record<string, number | boolean>>({})
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (settings) setDraft(settings.values)
  }, [settings])

  if (!org || !settings || !roles) return <div className="p-6 text-slate-500">Loading…</div>

  function toggle(role: string, permission: string) {
    const row = roles!.find((r) => r.role === role)!
    const isDefault = row.defaults.includes(permission)
    const has = row.effective.includes(permission)
    // Clicking cycles towards the opposite of now; back to default clears the override.
    const next = !has
    setPermission.mutate(
      { role, permission, granted: next === isDefault ? null : next },
      { onError: (e) => setMessage(apiErrorMessage(e, 'Could not change the permission.')) },
    )
  }

  const numberField = (key: string, label: string, unit: string, min: number, max: number) => (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          disabled={!isAdmin}
          className="w-24 rounded-md border border-slate-300 px-2 py-1"
          value={Number(draft[key] ?? settings.defaults[key])}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
        />
        <span className="text-xs text-slate-500">
          {unit} (default {String(settings.defaults[key])}, {min}–{max})
        </span>
      </span>
    </label>
  )
  const boolField = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        disabled={!isAdmin}
        checked={!!draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
      />
      {label}
    </label>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Organization settings — {org.name}</h1>
        {!isAdmin && (
          <p className="mt-1 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
            Read-only — only an organization admin can change these.
          </p>
        )}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Editing &amp; locks</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {numberField('edit_lock_timeout_minutes', 'Edit lock expires after inactivity', 'minutes', 1, 240)}
          {numberField('structure_lock_implicit_seconds', 'Structure lease after moving items', 'seconds', 15, 1800)}
        </div>
        <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Separation of duties</h2>
        <div className="space-y-1.5">
          {boolField('suggestion_self_resolve', 'Authors may resolve their own change suggestions')}
          {boolField('applicability_self_approve', 'The person proposing "Not applicable" may also approve it')}
        </div>
        {isAdmin && (
          <div className="mt-4 flex items-center gap-3">
            <button
              className={btn.primary}
              onClick={() =>
                saveSettings.mutate(draft, {
                  onSuccess: () => setMessage('Saved.'),
                  onError: (e) => setMessage(apiErrorMessage(e, 'Could not save.')),
                })
              }
            >
              Save settings
            </button>
            {message && <span className="text-xs text-slate-500">{message}</span>}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Role permissions</h2>
        <p className="mb-3 text-xs text-slate-500">
          What each project role may do in every project of this organization. Bold = changed from the default; click a
          cell to grant or revoke. Org admins always have everything.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 text-center font-medium capitalize">
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROJECT_PERMS.map((p) => (
                <tr key={p} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">
                    <span className="text-slate-700">{PERMISSION_INFO[p]}</span>
                    <span className="ml-1 font-mono text-[10px] text-slate-400">{p}</span>
                  </td>
                  {ROLES.map((role) => {
                    const row = roles.find((r) => r.role === role)
                    const has = !!row?.effective.includes(p)
                    const changed = has !== !!row?.defaults.includes(p)
                    return (
                      <td key={role} className="px-2 text-center">
                        <button
                          disabled={!isAdmin || setPermission.isPending}
                          onClick={() => toggle(role, p)}
                          aria-label={`${role}: ${p} ${has ? 'granted' : 'not granted'}`}
                          className={`h-6 w-6 rounded ${has ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-300'} ${
                            changed ? 'font-bold ring-2 ring-amber-400' : ''
                          } disabled:cursor-default`}
                        >
                          {has ? '✓' : '–'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Every member of the organization</h3>
        <div className="space-y-1">
          {ORG_PERMS.map((p) => {
            const row = roles.find((r) => r.role === 'org_member')
            const has = !!row?.effective.includes(p)
            return (
              <label key={p} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" disabled={!isAdmin} checked={has} onChange={() => toggle('org_member', p)} />
                {PERMISSION_INFO[p]} <span className="font-mono text-[10px] text-slate-400">{p}</span>
              </label>
            )
          })}
        </div>
      </section>
    </div>
  )
}
