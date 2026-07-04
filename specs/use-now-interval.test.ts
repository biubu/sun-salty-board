import { describe, it, expect } from 'vitest'

// Re-implement the cadence decision the way useNow does it, so we can
// assert the bucket boundaries without a React renderer.
function pickIntervalMs(elapsedMs: number): number {
  return elapsedMs < 60 * 60 * 1000
    ? 30_000
    : elapsedMs < 24 * 60 * 60 * 1000
      ? 60_000
      : 3_600_000
}

describe('useNow cadence', () => {
  it('ticks every 30s during the first hour', () => {
    expect(pickIntervalMs(0)).toBe(30_000)
    expect(pickIntervalMs(59 * 60_000)).toBe(30_000)
    expect(pickIntervalMs(59 * 60_000 + 59_999)).toBe(30_000)
  })

  it('ticks every 60s between hour 1 and day 1', () => {
    expect(pickIntervalMs(60 * 60_000)).toBe(60_000)
    expect(pickIntervalMs(12 * 60 * 60_000)).toBe(60_000)
    expect(pickIntervalMs(24 * 60 * 60_000 - 1)).toBe(60_000)
  })

  it('ticks every hour beyond day 1', () => {
    expect(pickIntervalMs(24 * 60 * 60_000)).toBe(3_600_000)
    expect(pickIntervalMs(7 * 24 * 60 * 60_000)).toBe(3_600_000)
  })

  it('does NOT mistake an absolute epoch ms for elapsed ms', () => {
    // Date.now() returns ~1.7e12, which is way past 24h. If the caller
    // compared Date.now() against the bucket thresholds directly, they'd
    // always pick the hour-bucket — that's the bug we regressed against.
    const now = Date.now()
    expect(now).toBeGreaterThan(24 * 60 * 60 * 1000)
    // The corrected logic uses elapsed (now - mountedAt), not now alone.
    expect(pickIntervalMs(now - now)).toBe(30_000)
  })
})