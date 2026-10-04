import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConflictDialog from './ConflictDialog'
import DiffText from './DiffText'

describe('ConflictDialog', () => {
  it('shows what changed meanwhile and offers the ways out', () => {
    const onReload = vi.fn()
    const onOverwrite = vi.fn()
    render(
      <ConflictDialog
        conflict={{
          your_version: 2,
          current_version: 3,
          etag: '"x:3"',
          changes_since_yours: [
            {
              field: 'title',
              old: 'A',
              new: 'B',
              ops: [
                { op: 'delete', text: 'A' },
                { op: 'insert', text: 'B' },
              ],
            },
          ],
        }}
        mine={{ title: 'Mine' }}
        onReload={onReload}
        onOverwrite={onOverwrite}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('version 2')).toBeTruthy()
    expect(screen.getByText('Title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Discard mine/ }))
    fireEvent.click(screen.getByRole('button', { name: /Apply mine on top of v3/ }))
    expect(onReload).toHaveBeenCalled()
    expect(onOverwrite).toHaveBeenCalled()
  })
})

describe('DiffText', () => {
  it('marks deletions and insertions', () => {
    const { container } = render(
      <DiffText
        ops={[
          { op: 'equal', text: 'last ' },
          { op: 'delete', text: '2' },
          { op: 'insert', text: '3' },
          { op: 'equal', text: ' h' },
        ]}
      />,
    )
    expect(container.querySelector('del')?.textContent).toBe('2')
    expect(container.querySelector('ins')?.textContent).toBe('3')
  })
})
