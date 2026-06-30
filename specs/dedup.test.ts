import { describe, it, expect } from 'vitest'

describe('Deduplication Logic', () => {
  const DEDUP_WINDOW = 100
  let lastEventTime = 0

  function isDuplicate(maxWindow: number = DEDUP_WINDOW): boolean {
    const now = Date.now()
    if (now - lastEventTime < maxWindow) return true
    lastEventTime = now
    return false
  }

  it('should not deduplicate first event', () => {
    lastEventTime = 0
    expect(isDuplicate()).toBe(false)
  })

  it('should deduplicate events within window', () => {
    lastEventTime = Date.now()
    expect(isDuplicate()).toBe(true)
  })

  it('should pass events outside window', () => {
    lastEventTime = Date.now() - 200
    expect(isDuplicate(100)).toBe(false)
  })
})
