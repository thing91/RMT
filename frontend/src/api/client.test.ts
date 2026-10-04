import { describe, expect, it } from 'vitest'
import { apiErrorDetail, apiErrorMessage } from './client'

const err = (detail: unknown, status = 422) => ({ response: { status, data: { detail } } })

describe('apiErrorMessage', () => {
  it('reads plain, validation and structured details', () => {
    expect(apiErrorMessage(err('Nope'))).toBe('Nope')
    expect(apiErrorMessage(err([{ msg: 'field required' }]))).toBe('field required')
    expect(apiErrorMessage(err({ message: 'Cannot approve yet.', reasons: ['2 comment thread(s) still open'] }))).toBe(
      'Cannot approve yet. 2 comment thread(s) still open',
    )
  })

  it('hides internal reason codes', () => {
    expect(apiErrorMessage(err({ message: 'Needs a comment.', reasons: ['comment_required'] }))).toBe(
      'Needs a comment.',
    )
  })

  it('exposes the structured detail, e.g. who holds a lock', () => {
    expect(apiErrorDetail(err({ code: 'locked', lock: { user_name: 'Anna' } }, 423))?.lock?.user_name).toBe('Anna')
    expect(apiErrorDetail(err('plain'))).toBeNull()
  })
})
