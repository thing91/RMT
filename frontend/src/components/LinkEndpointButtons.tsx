import { useLinkCreation, type LinkEndpoint } from '../linking/LinkCreationContext'

/** Two small per-row buttons — mark this item as a link's source or target.
 * Picking both (even across two split-view panes, since the state is
 * shared) pops up a confirmation with a link-type picker, instead of
 * requiring the full detail panel + knowing the other item's key. */
export default function LinkEndpointButtons({ item }: { item: LinkEndpoint }) {
  const { source, target, pickSource, pickTarget } = useLinkCreation()
  const isSource = source?.id === item.id
  const isTarget = target?.id === item.id

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        title="Mark as link source"
        onClick={(e) => {
          e.stopPropagation()
          pickSource(item)
        }}
        className={`flex h-4 w-6 items-center justify-center rounded text-[9px] font-bold leading-none ${
          isSource ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500 hover:bg-blue-100 hover:text-blue-700'
        }`}
      >
        •→
      </button>
      <button
        title="Mark as link target"
        onClick={(e) => {
          e.stopPropagation()
          pickTarget(item)
        }}
        className={`flex h-4 w-6 items-center justify-center rounded text-[9px] font-bold leading-none ${
          isTarget ? 'bg-purple-600 text-white' : 'bg-slate-200 text-slate-500 hover:bg-purple-100 hover:text-purple-700'
        }`}
      >
        →•
      </button>
    </span>
  )
}
