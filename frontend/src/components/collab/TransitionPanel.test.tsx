import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SubjectWorkflow } from '../../api/types'
import TransitionPanel from './TransitionPanel'

const workflow: SubjectWorkflow = {
  state: 'review',
  state_label: 'In Review',
  states: [
    {
      key: 'review',
      label: 'In Review',
      category: 'active',
      read_only: false,
      is_obsolete: false,
      initial: false,
      color: '#d97706',
    },
  ],
  transitions: [
    {
      key: 'approve',
      label: 'Approve',
      to: 'approved',
      to_label: 'Approved',
      requires_comment: false,
      requires_signature: true,
      allowed: true,
      reasons: [],
    },
    {
      key: 'reject',
      label: 'Reject',
      to: 'rejected',
      to_label: 'Rejected',
      requires_comment: true,
      requires_signature: false,
      allowed: true,
      reasons: [],
    },
    {
      key: 'verify',
      label: 'Verify',
      to: 'verified',
      to_label: 'Verified',
      requires_comment: false,
      requires_signature: false,
      allowed: false,
      reasons: ['Linked test(s) not passed: VA-001'],
    },
  ],
  history: [],
  read_only_reason: null,
}

describe('TransitionPanel', () => {
  it('disables transitions the user may not run and explains why', () => {
    render(<TransitionPanel workflow={workflow} run={vi.fn()} />)
    const verify = screen.getByRole('button', { name: /Verify/ })
    expect(verify).toHaveProperty('disabled', true)
    expect(verify.getAttribute('title')).toContain('VA-001')
  })

  it('requires a justification before confirming a comment-required transition', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    render(<TransitionPanel workflow={workflow} run={run} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Out of scope' } })
    fireEvent.click(confirm)
    await vi.waitFor(() =>
      expect(run).toHaveBeenCalledWith('reject', { comment: 'Out of scope', password: undefined, payload: {} }),
    )
  })

  it('asks for the password when the transition needs an e-signature', () => {
    render(<TransitionPanel workflow={workflow} run={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    expect(screen.getByText(/Electronic signature/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign & confirm' })).toHaveProperty('disabled', true)
  })
})
