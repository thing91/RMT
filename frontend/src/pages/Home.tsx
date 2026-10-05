import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useCreateProject, useOrg, useProjects } from '../api/hooks'
import { useWorkSummary } from '../api/workspaceHooks'
import { useAuth } from '../auth/AuthContext'
import { plural, useI18n, useT } from '../i18n'

function NewProjectForm({ orgId }: { orgId: string }) {
  const createProject = useCreateProject(orgId)
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')
  const [kind, setKind] = useState<'project' | 'library'>('project')
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:border-blue-400 hover:text-blue-600"
      >
        <span className="text-2xl leading-none">+</span>
        <span className="text-sm font-medium">{t('New project')}</span>
      </button>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    createProject.mutate(
      { name: name.trim(), visibility, kind },
      {
        onSuccess: (project) => navigate(`/projects/${project.id}`),
        onError: (err) => setError(apiErrorMessage(err, t('Could not create this project.'))),
      },
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-h-[132px] flex-col justify-between rounded-xl border border-blue-200 bg-blue-50 p-4"
    >
      <div className="space-y-2">
        <input
          autoFocus
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder={t('Project name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
        >
          <option value="private">{t('Private')}</option>
          <option value="public">{t('Public')}</option>
        </select>
        <select
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'project' | 'library')}
        >
          <option value="project">{t('Project')}</option>
          <option value="library">{t('Generic requirements library')}</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t('Create')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          {t('Cancel')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}

export default function Home() {
  const { org, isLoading: orgLoading } = useOrg()
  const { data: projects, isLoading: projectsLoading } = useProjects(org?.id)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const { data: waiting } = useWorkSummary(!!user)

  if (orgLoading || projectsLoading) {
    return <div className="p-6 text-slate-500">{t('Loading…')}</div>
  }

  if (!org) {
    return (
      <div className="p-6 text-slate-500">
        {t('No organization found. Run')}{' '}
        <code className="mx-1 rounded bg-slate-100 px-1">python -m app.seed</code> {t('in the backend.')}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {org.name}
      </div>
      <h1 className="mb-6 text-2xl font-semibold text-slate-800">{t('Projects')}</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(projects ?? []).map((project) => (
          <button
            key={project.id}
            onClick={() => navigate(`/projects/${project.id}`)}
            className="flex min-h-[132px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:shadow-md"
          >
            <div>
              <div className="font-semibold text-slate-800">{project.name}</div>
              <span
                className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  project.visibility === 'public'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {t(project.visibility)}
              </span>
              {project.kind === 'library' && (
                <span className="ml-1 mt-1 inline-block rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                  {t('library')}
                </span>
              )}
            </div>
            {(waiting?.[project.id] ?? 0) > 0 ? (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {plural(lang, waiting![project.id], 'element czeka', 'elementy czekają', 'elementów czeka', 'item waiting', 'items waiting')}{' '}
                {lang === 'pl' ? 'na Ciebie' : 'for you'}
              </span>
            ) : (
              <span className="text-sm text-blue-600">{t('Open')} →</span>
            )}
          </button>
        ))}
        <NewProjectForm orgId={org.id} />
      </div>
    </div>
  )
}
