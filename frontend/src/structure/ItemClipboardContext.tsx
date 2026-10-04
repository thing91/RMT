import { createContext, useContext, useState, type ReactNode } from 'react'

export interface ClipboardState {
  id: string
  mode: 'cut' | 'copy'
}

interface ItemClipboardApi {
  clipboard: ClipboardState | null
  setClipboard: (c: ClipboardState | null) => void
}

const ItemClipboardContext = createContext<ItemClipboardApi | null>(null)

/** Scoped at the project layout (not per-page) so cutting/copying an item in
 * Tree View and pasting it in Table View — or switching documents in
 * between — doesn't lose the clipboard: switching views there is just a
 * route change inside the same provider. */
export function ItemClipboardProvider({ children }: { children: ReactNode }) {
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)

  return (
    <ItemClipboardContext.Provider value={{ clipboard, setClipboard }}>
      {children}
    </ItemClipboardContext.Provider>
  )
}

export function useItemClipboard(): ItemClipboardApi {
  const ctx = useContext(ItemClipboardContext)
  if (!ctx) throw new Error('useItemClipboard must be used within ItemClipboardProvider')
  return ctx
}
