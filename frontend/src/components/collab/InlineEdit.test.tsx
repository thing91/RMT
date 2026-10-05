import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineEditField } from './InlineEdit'

function setup(props: Partial<Parameters<typeof InlineEditField>[0]> = {}) {
  const onBegin = vi.fn(async () => true)
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <InlineEditField value="Battery shall last 2h" editable onBegin={onBegin} onSave={onSave} onCancel={onCancel} {...props} />,
  )
  return { onBegin, onSave, onCancel }
}

describe('InlineEditField', () => {
  it('starts editing on double-click (taking the lock first) and saves on blur', async () => {
    const { onBegin, onSave } = setup()
    fireEvent.click(screen.getByText('Battery shall last 2h'))
    expect(onBegin).not.toHaveBeenCalled() // a single click in the document only selects
    await act(async () => fireEvent.doubleClick(screen.getByText('Battery shall last 2h')))
    expect(onBegin).toHaveBeenCalledOnce()
    const input = screen.getByDisplayValue('Battery shall last 2h')
    fireEvent.change(input, { target: { value: 'Battery shall last 3h' } })
    fireEvent.blur(input)
    expect(onSave).toHaveBeenCalledWith('Battery shall last 3h')
  })

  it('releases the lock without saving when nothing changed or on Escape', async () => {
    const { onSave, onCancel } = setup()
    await act(async () => fireEvent.doubleClick(screen.getByText('Battery shall last 2h')))
    fireEvent.blur(screen.getByDisplayValue('Battery shall last 2h'))
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()

    await act(async () => fireEvent.doubleClick(screen.getByText('Battery shall last 2h')))
    const input = screen.getByDisplayValue('Battery shall last 2h')
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('stays read-only when the lock is refused', async () => {
    const { onBegin } = setup({ onBegin: vi.fn(async () => false) })
    await act(async () => fireEvent.doubleClick(screen.getByText('Battery shall last 2h')))
    expect(onBegin).toBeDefined()
    expect(screen.queryByDisplayValue('Battery shall last 2h')).toBeNull()
  })

  it('edits on a single click in the details panel', async () => {
    const { onBegin } = setup({ trigger: 'click' })
    await act(async () => fireEvent.click(screen.getByText('Battery shall last 2h')))
    expect(onBegin).toHaveBeenCalledOnce()
    expect(screen.getByDisplayValue('Battery shall last 2h')).toBeTruthy()
  })

  it('renders plain text when not editable', async () => {
    const { onBegin } = setup({ editable: false })
    await act(async () => fireEvent.doubleClick(screen.getByText('Battery shall last 2h')))
    expect(onBegin).not.toHaveBeenCalled()
  })
})
