import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SubjectWorkflow, TransitionOption } from '../../api/types'
import WorkflowActions from './WorkflowActions'

const state = (key: string, label: string, category: string) => ({
  key,
  label,
  category,
  read_only: false,
  is_obsolete: key === 'obsolete',
  initial: key === 'draft',
  color: '#64748b',
})
const tr = (key: string, label: string, to: string, allowed = true): TransitionOption => ({
  key,
  label,
  to,
  to_label: to,
  requires_comment: false,
  requires_signature: false,
  allowed,
  reasons: allowed ? [] : ['Only an approver can do this.'],
})

function workflow(current: string, transitions: TransitionOption[]): SubjectWorkflow {
  return {
    state: current,
    state_label: current,
    states: [
      state('draft', 'Draft', 'draft'),
      state('review', 'In Review', 'active'),
      state('approved', 'Approved', 'active'),
      state('rejected', 'Rejected', 'side'),
      state('obsolete', 'Obsolete', 'side'),
    ],
    transitions,
    history: [],
  } as unknown as SubjectWorkflow
}

function renderIt(wf: SubjectWorkflow) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <WorkflowActions workflow={wf} run={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('WorkflowActions', () => {
  it('offers the next step forward as the main button, not going back or rejecting', () => {
    renderIt(
      workflow('review', [
        tr('rework', 'Back to draft', 'draft'),
        tr('approve', 'Approve', 'approved'),
        tr('reject', 'Reject', 'rejected'),
        tr('retire', 'Make obsolete', 'obsolete'),
      ]),
    )
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons[0]).toBe('Approve')
    fireEvent.click(screen.getByText('More ▾'))
    expect(screen.getByText('Back to draft')).toBeTruthy()
    expect(screen.getByText('Reject')).toBeTruthy()
  })

  it('has no main button when the only forward step is not allowed', () => {
    renderIt(workflow('review', [tr('approve', 'Approve', 'approved', false), tr('rework', 'Back to draft', 'draft')]))
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    fireEvent.click(screen.getByText('More ▾'))
    expect(screen.getByText('Only an approver can do this.')).toBeTruthy()
  })
})
