import { useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useIsOrgAdmin } from '../api/collabHooks'
import { useCreateLinkType, useItemTypes, useLinkTypes, useOrg } from '../api/hooks'
import { useT } from '../i18n'

function TypeMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { id: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">
        {label} <span className="text-slate-400">(none selected = any type allowed)</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.id}
            className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
          >
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={(e) => {
                if (e.target.checked) onChange([...selected, o.id])
                else onChange(selected.filter((id) => id !== o.id))
              }}
            />
            {o.name}
          </label>
        ))}
      </div>
    </div>
  )
}

function NewLinkTypeForm({ orgId, contentTypes }: { orgId: string; contentTypes: { id: string; name: string }[] }) {
  const t = useT()
  const createLinkType = useCreateLinkType(orgId)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [inverseName, setInverseName] = useState('')
  const [sourceTypes, setSourceTypes] = useState<string[]>([])
  const [targetTypes, setTargetTypes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + {t('Create link type')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    createLinkType.mutate(
      {
        key,
        name,
        inverse_name: inverseName,
        allowed_source_types: sourceTypes,
        allowed_target_types: targetTypes,
      },
      {
        onSuccess: () => {
          setOpen(false)
          setKey('')
          setName('')
          setInverseName('')
          setSourceTypes([])
          setTargetTypes([])
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create link type.'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Key')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Name (e.g. Verifies)')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Inverse name (e.g. Verified by)')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={inverseName}
            onChange={(e) => setInverseName(e.target.value)}
            required
          />
        </div>
      </div>

      <TypeMultiSelect
        label={t('Allowed source types')}
        options={contentTypes}
        selected={sourceTypes}
        onChange={setSourceTypes}
      />
      <TypeMultiSelect
        label={t('Allowed target types')}
        options={contentTypes}
        selected={targetTypes}
        onChange={setTargetTypes}
      />

      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          {t('Create')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
          {t('Cancel')}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}

export default function LinkTypesAdmin() {
  const t = useT()
  const orgAdmin = useIsOrgAdmin()
  const { org } = useOrg()
  const { data: linkTypes, isLoading } = useLinkTypes(org?.id)
  const { data: itemTypes } = useItemTypes(org?.id)
  const contentTypes = (itemTypes ?? []).filter((t) => t.behavior === 'content')
  const typeName = (id: string) => itemTypes?.find((t) => t.id === id)?.name ?? id.slice(0, 8)

  if (isLoading || !org) return <div className="p-6 text-slate-500">{t('Loading link types…')}</div>

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">{t('Link Types')}</h1>
        {!orgAdmin && (
          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
            {t('Read-only — only an organization admin can change this organization-wide data.')}
          </p>
        )}
        {orgAdmin && <NewLinkTypeForm orgId={org.id} contentTypes={contentTypes} />}
      </div>

      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        {t('A link type with no allowed types set is free-form — any item type can use it in either direction. Restricting it (e.g. “Verifies” only from Verification Activity to Requirement) makes creating an invalid link fail with an explanatory error.')}
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">{t('Name')}</th>
              <th className="px-3 py-2">{t('Inverse')}</th>
              <th className="px-3 py-2">{t('Allowed source')}</th>
              <th className="px-3 py-2">{t('Allowed target')}</th>
            </tr>
          </thead>
          <tbody>
            {linkTypes?.map((lt) => (
              <tr key={lt.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">{lt.name}</td>
                <td className="px-3 py-2 text-slate-500">{lt.inverse_name}</td>
                <td className="px-3 py-2 text-slate-600">
                  {lt.allowed_source_types.length === 0
                    ? <span className="text-slate-400">{t('Any')}</span>
                    : lt.allowed_source_types.map(typeName).join(', ')}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {lt.allowed_target_types.length === 0
                    ? <span className="text-slate-400">{t('Any')}</span>
                    : lt.allowed_target_types.map(typeName).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
