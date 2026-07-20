import { describe, expect, it } from 'vitest'
import { isRetryableJobError, NonRetryableError } from './errors'

describe('job error retry classification', () => {
  it('does not retry explicit policy failures', () => {
    expect(isRetryableJobError(new NonRetryableError('policy violation'))).toBe(false)
  })

  it('keeps ordinary failures retryable', () => {
    expect(isRetryableJobError(new Error('temporary failure'))).toBe(true)
  })
})
