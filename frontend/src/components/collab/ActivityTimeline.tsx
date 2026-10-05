import { useMemo, useState, type ReactNode } from 'react'
import { useItemAudit, useItemDiff, useItemVersions, useSignatures, useSubjectWorkflow } from '../../api/collabHooks'
import type { ItemVersion } from '../../api/collabTypes'
import { useCreateComment, useItemComments, useOrgUsers } from '../../api/hooks'
import type { ItemComment } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { timeAgo, useI18n } from '../../i18n'
import { CommentForm, Thread } from '../CommentsSection'
import DiffText, { fieldLabel, formatValue } from './DiffText'

const REASON_LABEL: Record<string, string> = {
  create: 'Created',
  edit: 'Edited',
  suggestion: 'Suggestion applied',
  import: 'Imported',
  migration: 'Initial version',
  revert: 'Reverted',
}

type Filter = 'all' | 'comments' | 'changes'

type Entry =
  | { kind: 'comment'; at: string; thread: ItemComment }
  | { kind: 'version'; at: string; version: ItemVersion }
  | { kind: 'workflow'; at: string; id: string; node: ReactNode }
  | { kind: 'other'; at: string; id: string; node: ReactNode }

function Dot({ color }: { color: string }) {
  return <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${color}`} />
}

/** One version: who changed what; click to see the diff against the
 * previous version. */
function VersionEntry({ itemId, v }: { itemId: string; v: ItemVersion }) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const { data: diff } = useItemDiff(itemId, open && v.version > 1 ? v.version - 1 : undefined, open ? v.version : undefined)
  return (
    <div>
      <button onClick={() => setOpen((x) => !x)} className="text-left text-xs text-slate-600 hover:text-slate-900">
        <b className="font-medium text-slate-800">{v.author ?? t('System')}</b> · {t(REASON_LABEL[v.reason] ?? v.reason)}{' '}
        <span className="font-mono text-slate-400">v{v.version}</span>
        {v.source_ref && <span className="text-slate-500"> · {v.source_ref}</span>}
        <span className="ml-1 text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      <div className="text-[11px] text-slate-400">{timeAgo(lang, v.created_at)}</div>
      {v.note && <div className="text-xs italic text-slate-500">“{v.note}”</div>}
      {open && (
        <div className="mt-1 space-y-2 rounded-md bg-slate-50 p-2 text-xs">
          {v.version === 1 ? (
            <p className="text-slate-400">{t('First version — nothing to compare against.')}</p>
          ) : (
            <>
              {(diff?.changes ?? []).length === 0 && <p className="text-slate-400">{t('No content changes.')}</p>}
              {(diff?.changes ?? []).map((c) => (
                <div key={c.field}>
                  <div className="font-semibold text-slate-500">{t(fieldLabel(c.field))}</div>
                  {c.ops ? (
                    <DiffText ops={c.ops} />
                  ) : (
                    <span>
                      <del className="text-red-600">{formatValue(c.old)}</del> →{' '}
                      <ins className="text-green-700 no-underline">{formatValue(c.new)}</ins>
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Everything that happened to an item on one timeline, newest first:
 * comments (with replies, resolve, "make it a suggestion"), content
 * versions with their diffs, workflow steps, signatures and other audited
 * events. A filter narrows it to the discussion or to the changes. */
export default function ActivityTimeline({
  itemId,
  orgId,
  onConvert,
}: {
  itemId: string
  orgId: string
  onConvert?: (comment: ItemComment) => void
}) {
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const { data: threads } = useItemComments(itemId)
  const { data: versions } = useItemVersions(itemId)
  const { data: workflow } = useSubjectWorkflow('item', itemId)
  const { data: signatures } = useSignatures(itemId)
  const { data: audit } = useItemAudit(itemId)
  const { data: orgUsers } = useOrgUsers(orgId)
  const createComment = useCreateComment(itemId)
  const [filter, setFilter] = useState<Filter>('all')
  const users = orgUsers ?? []

  const entries = useMemo(() => {
    const list: Entry[] = []
    for (const thread of threads ?? []) list.push({ kind: 'comment', at: thread.created_at, thread })
    for (const v of versions ?? []) if (v.reason !== 'transition') list.push({ kind: 'version', at: v.created_at, version: v })
    for (const h of workflow?.history ?? []) {
      list.push({
        kind: 'workflow',
        at: h.at,
        id: h.id,
        node: (
          <div>
            <div className="text-xs text-slate-600">
              <b className="font-medium text-slate-800">{h.actor ?? t('System')}</b> · {t(h.from_label ?? '')} → <b>{t(h.to_label ?? '')}</b>
              {h.notes?.signed ? ' · ✍' : ''}
              {typeof h.notes?.change_request === 'string' && ` · ${h.notes.change_request}`}
            </div>
            <div className="text-[11px] text-slate-400">{timeAgo(lang, h.at)}</div>
            {h.comment && <div className="text-xs italic text-slate-500">“{h.comment}”</div>}
          </div>
        ),
      })
    }
    for (const s of signatures ?? []) {
      list.push({
        kind: 'other',
        at: s.signed_at,
        id: `sig-${s.id}`,
        node: (
          <div className="text-xs text-slate-600">
            ✍ <b className="font-medium text-slate-800">{s.user}</b> — {s.meaning}
            {s.subject_version ? ` (v${s.subject_version})` : ''}
            <span className="block font-mono text-[10px] text-slate-400" title={t('SHA-256 of the signed content')}>
              {s.content_hash.slice(0, 24)}…
            </span>
          </div>
        ),
      })
    }
    // Audit events not already shown as a version or a workflow step.
    for (const e of audit ?? []) {
      if (e.action === 'workflow.transition' || e.action.startsWith('item.') || e.action.startsWith('comment.')) continue
      list.push({
        kind: 'other',
        at: e.created_at,
        id: `audit-${e.id}`,
        node: (
          <div className="text-xs text-slate-600">
            {e.actor && <b className="font-medium text-slate-800">{e.actor} · </b>}
            {e.summary}
          </div>
        ),
      })
    }
    return list.sort((a, b) => b.at.localeCompare(a.at))
  }, [threads, versions, workflow, signatures, audit, t, lang])

  const shown = entries.filter((e) =>
    filter === 'all' ? true : filter === 'comments' ? e.kind === 'comment' : e.kind !== 'comment',
  )
  const chip = (f: Filter, label: string) => (
    <button
      onClick={() => setFilter(f)}
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        filter === f ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-3">
      {user && (
        <CommentForm
          placeholder={t('Add a comment… (@ to mention someone)')}
          submitLabel={t('Comment')}
          onSubmit={(body) => createComment.mutate({ body })}
          users={users}
        />
      )}
      <div className="flex gap-1">
        {chip('all', t('Everything'))}
        {chip('comments', t('Comments'))}
        {chip('changes', t('Changes'))}
      </div>
      <ol className="relative ml-1 space-y-3 border-l border-slate-200 pl-4">
        {shown.map((e) => {
          if (e.kind === 'comment') {
            return (
              <li key={`c-${e.thread.id}`} className="relative">
                <Dot color={e.thread.resolved ? 'bg-green-400' : 'bg-blue-500'} />
                <Thread thread={e.thread} currentUserId={user?.id} users={users} onConvert={onConvert} />
              </li>
            )
          }
          if (e.kind === 'version') {
            return (
              <li key={`v-${e.version.version}`} className="relative">
                <Dot color="bg-slate-400" />
                <VersionEntry itemId={itemId} v={e.version} />
              </li>
            )
          }
          return (
            <li key={e.id} className="relative">
              <Dot color={e.kind === 'workflow' ? 'bg-violet-500' : 'bg-amber-400'} />
              {e.node}
            </li>
          )
        })}
        {shown.length === 0 && <li className="text-xs text-slate-400">{t('Nothing here yet.')}</li>}
      </ol>
    </div>
  )
}
