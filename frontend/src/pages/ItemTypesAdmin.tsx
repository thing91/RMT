import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useIsOrgAdmin } from '../api/collabHooks'
import {
  useCreateAttribute,
  useCreateItemType,
  useDeprecateAttribute,
  useItemTypes,
  useOrg,
} from '../api/hooks'
import type { AttributeDataType, ItemType, ItemTypeAttribute } from '../api/types'
import { useT } from '../i18n'

/** The `status` attribute's values are generated from the item type's
 * workflow (states), so they're shown read-only here with a pointer to
 * the workflow editor instead of being edited as plain enum options. */
function StatusWorkflowFlags({ attr }: { itemType: ItemType; attr: ItemTypeAttribute }) {
  const t = useT()
  return (
    <div className="mb-2 rounded-md border border-slate-200 bg-white p-2 text-xs">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {t('Status values — managed by the workflow')}
      </p>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {(attr.enum_options ?? [])
          .filter((o) => !o.deprecated)
          .map((o) => (
            <span
              key={o.value}
              className="rounded-full px-2 py-0.5 font-medium"
              style={{ backgroundColor: `${o.color ?? '#64748b'}1f`, color: o.color ?? '#64748b' }}
            >
              {o.label}
            </span>
          ))}
      </div>
      <Link to="/admin/workflows" className="font-medium text-blue-600 hover:text-blue-800">
        {t('Edit states and transitions in Workflows →')}
      </Link>
    </div>
  )
}

const DATA_TYPES: { value: AttributeDataType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'rich_text', label: 'Rich text (Markdown)' },
  { value: 'enum', label: 'Single select' },
  { value: 'multi_enum', label: 'Multi select' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'user_ref', label: 'User reference' },
  { value: 'item_ref', label: 'Item reference' },
]

function NewItemTypeForm({ orgId }: { orgId: string }) {
  const t = useT()
  const createType = useCreateItemType(orgId)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [behavior, setBehavior] = useState<'content' | 'structural'>('content')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + {t('Create item type')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    createType.mutate(
      { key, name, prefix, behavior },
      {
        onSuccess: () => {
          setOpen(false)
          setKey('')
          setName('')
          setPrefix('')
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create item type.'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Key (unique)')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Display name')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Key prefix (e.g. RISK-)')}</label>
          <input
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">{t('Behavior')}</label>
          <select
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            value={behavior}
            onChange={(e) => setBehavior(e.target.value as 'content' | 'structural')}
          >
            <option value="content">{t('Content (leaf item, e.g. Requirement)')}</option>
            <option value="structural">{t('Structural (can have children, e.g. Section)')}</option>
          </select>
        </div>
      </div>
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

function NewAttributeForm({ itemType }: { itemType: ItemType }) {
  const t = useT()
  const createAttribute = useCreateAttribute()
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [dataType, setDataType] = useState<AttributeDataType>('text')
  const [optionsText, setOptionsText] = useState('')
  const [required, setRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
        + {t('Add attribute')}
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const needsOptions = dataType === 'enum' || dataType === 'multi_enum'
    const enum_options = needsOptions
      ? optionsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((v) => ({ value: v.toLowerCase().replace(/\s+/g, '_'), label: v, deprecated: false }))
      : undefined

    createAttribute.mutate(
      {
        itemTypeId: itemType.id,
        payload: { key, label, data_type: dataType, enum_options, required, order: itemType.attributes.length },
      },
      {
        onSuccess: () => {
          setOpen(false)
          setKey('')
          setLabel('')
          setOptionsText('')
        },
        onError: (err) => setError(apiErrorMessage(err, t('Could not create attribute.'))),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          placeholder={t('key (e.g. affected_subsystem)')}
          value={key}
          onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
          required
        />
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          placeholder={t('Label (e.g. Affected Subsystem)')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <select
          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          value={dataType}
          onChange={(e) => setDataType(e.target.value as AttributeDataType)}
        >
          {DATA_TYPES.map((dt) => (
            <option key={dt.value} value={dt.value}>
              {t(dt.label)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          {t('Required')}
        </label>
      </div>
      {(dataType === 'enum' || dataType === 'multi_enum') && (
        <input
          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          placeholder={t('Options, comma separated (e.g. Low, Medium, High)')}
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
        />
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
          {t('Add')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">
          {t('Cancel')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}

export default function ItemTypesAdmin() {
  const t = useT()
  const orgAdmin = useIsOrgAdmin()
  const { org } = useOrg()
  const { data: itemTypes, isLoading } = useItemTypes(org?.id)
  const deprecateAttribute = useDeprecateAttribute()

  if (isLoading || !org) return <div className="p-6 text-slate-500">{t('Loading item types…')}</div>

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">{t('Item Types')}</h1>
        {!orgAdmin && (
          <p className="mb-4 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
            {t('Read-only — only an organization admin can change this organization-wide data.')}
          </p>
        )}
        {orgAdmin && <NewItemTypeForm orgId={org.id} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {itemTypes?.map((itemType) => (
          <div key={itemType.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800">{itemType.name}</span>{' '}
                <span className="text-xs text-slate-400">
                  ({itemType.behavior}
                  {itemType.prefix ? `, prefix "${itemType.prefix}"` : ''})
                </span>
              </div>
              {itemType.is_system && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                  {t('Built-in')}
                </span>
              )}
            </div>

            {itemType.behavior === 'content' && (
              <>
                <ul className="mb-2 space-y-1">
                  {itemType.attributes.map((attr) => (
                    <li
                      key={attr.id}
                      className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs"
                    >
                      <span className={attr.deprecated ? 'text-slate-400 line-through' : 'text-slate-700'}>
                        {attr.label}{' '}
                        <span className="text-slate-400">
                          ({t(DATA_TYPES.find((d) => d.value === attr.data_type)?.label ?? attr.data_type)})
                        </span>
                        {attr.required && <span className="ml-1 text-red-500">*</span>}
                      </span>
                      {!attr.is_system && (
                        <button
                          onClick={() =>
                            deprecateAttribute.mutate({
                              itemTypeId: itemType.id,
                              attributeId: attr.id,
                              deprecated: !attr.deprecated,
                            })
                          }
                          className="text-slate-400 hover:text-amber-600"
                        >
                          {attr.deprecated ? t('Restore') : t('Deprecate')}
                        </button>
                      )}
                    </li>
                  ))}
                  {itemType.attributes.length === 0 && (
                    <li className="text-xs text-slate-400">{t('No attributes defined yet.')}</li>
                  )}
                </ul>
                {itemType.attributes
                  .filter((a) => a.key === 'status' && a.data_type === 'enum')
                  .map((a) => <StatusWorkflowFlags key={a.id} itemType={itemType} attr={a} />)}
                {orgAdmin && <NewAttributeForm itemType={itemType} />}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
