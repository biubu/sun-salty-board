import { describe, it, expect } from 'vitest'

// Mirror of HistoryItem.tsx formatTime — kept in sync so the relative-time
// display can be exercised without spinning up React. The hook-based
// auto-refresh (useNow) handles UI re-rendering; the math lives here.
function formatTime(dateStr: string, now: Date): string {
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
  const date = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? new Date(normalized)
    : new Date(normalized + 'Z')
  const ts = date.getTime()
  if (Number.isNaN(ts)) return ''
  const diffMs = now.getTime() - ts
  if (diffMs < 0) return 'just_now'
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just_now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return 'date'
}

describe('formatTime', () => {
  const now = new Date('2026-07-04T10:30:00Z')

  it('returns just_now under a minute', () => {
    const just = new Date(now.getTime() - 30_000).toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '')
    expect(formatTime(just, now)).toBe('just_now')
  })

  it('returns N minutes after a minute boundary', () => {
    const past = new Date(now.getTime() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '')
    expect(formatTime(past, now)).toBe('5m')
  })

  it('returns N hours after an hour boundary', () => {
    const past = new Date(now.getTime() - 3 * 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '')
    expect(formatTime(past, now)).toBe('3h')
  })

  it('clamps future timestamps to just_now (clock skew)', () => {
    const future = new Date(now.getTime() + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, '').replace(/Z$/, '')
    expect(formatTime(future, now)).toBe('just_now')
  })

  it('returns empty string for invalid input', () => {
    expect(formatTime('not a date', now)).toBe('')
  })

  it('interprets SQLite UTC default correctly', () => {
    // SQLite strftime('%Y-%m-%dT%H:%M:%S', 'now') emits UTC without Z suffix.
    const sqliteUtc = '2026-07-04T10:25:00'
    expect(formatTime(sqliteUtc, now)).toBe('5m')
  })

  it('respects an explicit Z suffix', () => {
    expect(formatTime('2026-07-04T10:25:00Z', now)).toBe('5m')
  })

  it('respects an explicit +08:00 offset', () => {
    // 10:25:00+08:00 == 02:25:00Z; 8 hours before 10:30Z
    expect(formatTime('2026-07-04T10:25:00+08:00', now)).toBe('8h')
  })
})