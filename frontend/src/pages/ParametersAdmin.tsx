import { useParams } from 'react-router-dom'
import { useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import {
  useCreateParameter,
  useDeleteParameter,
  useParameters,
  useParameterUsages,
  useUpdateParameter,
} from '../api/hooks'
import type { Parameter } from '../api/types'

function NewParameterForm({ projectId }: { projectId: string }) {
  const createParameter = useCreateParameter(projectId)
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [dataType, setDataType] = useState<'constant' | 'derived'>('constant')
  const [value, setValue] = useState('')
  const [formula, setFormula] = useState('')
  const [unit, setUnit] = useState('')
  const [source, setSource] = useState('assumed')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
        + Add parameter
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    createParameter.mutate(
      {
        key: key.toUpperCase().replace(/\s+/g, '_'),
        name,
        data_type: dataType,
        value: dataType === 'constant' && value ? Number(value) : undefined,
        formula: dataType === 'derived' ? formula : undefined,
        unit: unit || undefined,
        source,
      },
      {
        onSuccess: () => {
          setOpen(false)
          setKey('')
          setName('')
          setValue('')
          setFormula('')
          setUnit('')
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not create this parameter.')),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="KEY (e.g. BRAKE_TORQUE_MAX)" value={key} onChange={(e) => setKey(e.target.value)} required />
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={dataType} onChange={(e) => setDataType(e.target.value as 'constant' | 'derived')}>
          <option value="constant">Constant</option>
          <option value="derived">Derived (formula)</option>
        </select>
        <select className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="measured">Measured</option>
          <option value="estimated">Estimated</option>
          <option value="derived">Derived</option>
          <option value="assumed">Assumed</option>
        </select>
        {dataType === 'constant' ? (
          <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Formula (e.g. MASS_VEHICLE * DECEL_TARGET)" value={formula} onChange={(e) => setFormula(e.target.value)} />
        )}
        <input className="rounded-md border border-slate-300 px-2 py-1.5 text-sm" placeholder="Unit (e.g. Nm)" value={unit} onChange={(e) => setUnit(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Create</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}

function UsagesList({ parameterId }: { parameterId: string }) {
  const { data: usages } = useParameterUsages(parameterId)
  if (!usages || usages.length === 0) return <p className="text-xs text-slate-400">Not referenced by any item yet.</p>
  return (
    <ul className="space-y-0.5">
      {usages.map((u) => (
        <li key={u.item_id} className="text-xs text-slate-600">
          <span className="font-mono text-slate-400">{u.item_key ?? u.item_id.slice(0, 8)}</span> {u.item_title}
        </li>
      ))}
    </ul>
  )
}

function ParameterRow({ param }: { param: Parameter }) {
  const updateParameter = useUpdateParameter()
  const deleteParameter = useDeleteParameter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(param.value ?? ''))
  const [formula, setFormula] = useState(param.formula ?? '')
  const [showUsages, setShowUsages] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    updateParameter.mutate(
      {
        id: param.id,
        payload: param.data_type === 'constant' ? { value: Number(value) } : { formula },
      },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => setError(apiErrorMessage(err, 'Could not save.')),
      },
    )
  }

  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-mono text-xs text-slate-500">{param.key}</td>
      <td className="px-3 py-2 text-slate-700">{param.name}</td>
      <td className="px-3 py-2 text-xs text-slate-500">{param.data_type}</td>
      <td className="px-3 py-2">
        {editing ? (
          param.data_type === 'constant' ? (
            <input className="w-24 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs" value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <input className="w-48 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs" value={formula} onChange={(e) => setFormula(e.target.value)} />
          )
        ) : (
          <span>
            {param.computed_value ?? '?'} {param.unit ?? ''}
            {param.data_type === 'derived' && <span className="ml-1 text-xs text-slate-400">= {param.formula}</span>}
          </span>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">{param.source}</td>
      <td className="px-3 py-2 text-xs">
        <button onClick={() => setShowUsages((v) => !v)} className="text-blue-600 hover:underline">
          {param.used_in_count} used in
        </button>
        {showUsages && <div className="mt-1"><UsagesList parameterId={param.id} /></div>}
      </td>
      <td className="px-3 py-2 text-right text-xs">
        {editing ? (
          <>
            <button onClick={save} className="mr-2 font-medium text-blue-600 hover:text-blue-800">Save</button>
            <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-700">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="mr-2 text-slate-400 hover:text-slate-700">Edit</button>
            <button onClick={() => deleteParameter.mutate(param.id)} className="text-slate-400 hover:text-red-600">Delete</button>
          </>
        )}
      </td>
    </tr>
  )
}

export default function ParametersAdmin() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: params, isLoading } = useParameters(projectId)

  if (isLoading || !projectId) return <div className="p-6 text-slate-500">Loading parameters…</div>

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Parameters</h1>
        <NewParameterForm projectId={projectId} />
      </div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Numeric variables (§5.3, Valispace-style) — reference one from any item's description with{' '}
        <code className="rounded bg-slate-100 px-1">{'{{param:KEY}}'}</code>. A <code>derived</code>{' '}
        parameter's formula can reference other parameters' keys (+ - * / only, no arbitrary code).
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Traceability</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(params ?? []).map((p) => (
              <ParameterRow key={p.id} param={p} />
            ))}
            {(params ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">No parameters yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
