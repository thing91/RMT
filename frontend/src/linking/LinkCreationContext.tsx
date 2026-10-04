import { createContext, useContext, useState, type ReactNode } from 'react'

export interface LinkEndpoint {
  id: string
  key: string | null
  title: string
}

interface LinkCreationState {
  source: LinkEndpoint | null
  target: LinkEndpoint | null
  pickSource: (item: LinkEndpoint) => void
  pickTarget: (item: LinkEndpoint) => void
  clear: () => void
}

const LinkCreationContext = createContext<LinkCreationState | null>(null)

/** Shared across both split-view panes (and the single-pane case) so
 * picking "source" on one item and "target" on another — potentially in
 * different panes — surfaces one popup to confirm the link, instead of
 * needing the full detail-panel form and knowing the other item's key by
 * heart. Scoped per page (Tree/Table), not app-wide. */
export function LinkCreationProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<LinkEndpoint | null>(null)
  const [target, setTarget] = useState<LinkEndpoint | null>(null)

  return (
    <LinkCreationContext.Provider
      value={{
        source,
        target,
        pickSource: (item) => setSource((prev) => (prev?.id === item.id ? null : item)),
        pickTarget: (item) => setTarget((prev) => (prev?.id === item.id ? null : item)),
        clear: () => {
          setSource(null)
          setTarget(null)
        },
      }}
    >
      {children}
    </LinkCreationContext.Provider>
  )
}

export function useLinkCreation(): LinkCreationState {
  const ctx = useContext(LinkCreationContext)
  if (!ctx) throw new Error('useLinkCreation must be used within LinkCreationProvider')
  return ctx
}
