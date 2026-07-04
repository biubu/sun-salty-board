interface SensitiveItem {
  id: number
  content: string
  dataType: string
  capturedAt: number
}

let nextId = 1
const store: Map<number, SensitiveItem> = new Map()

// Sensitive clipboard captures (e.g. passwords copied under Ctrl-down on
// Windows) live in this in-memory map. Without a bound the store grows
// without limit for users who routinely copy credentials. Two safeguards keep
// memory pressure predictable:
//
//   * TTL — each entry expires 5 minutes after capture; stale entries are
//     evicted the next time the map is read (cheap because we walk it
//     anyway when serialising results).
//   * max entries — if the store would grow past 1000 items, evict the
//     oldest 10% at intake. Prevents unbounded growth in pathological
//     paste-storm sessions where TTL hasn't fired yet.

const TTL_MS = 5 * 60 * 1000
const MAX_ITEMS = 1000
const EVICT_BATCH_RATIO = 0.1

let evictionTimer: ReturnType<typeof setInterval> | null = null

function evictExpired(now: number = Date.now()): void {
  if (store.size === 0) return
  for (const [id, item] of store) {
    if (now - item.capturedAt > TTL_MS) store.delete(id)
  }
}

export function addSensitiveItem(
  content: string,
  dataType: string,
): number {
  // Cap-pop before insert: keeps the map strictly bounded even under bursts.
  if (store.size >= MAX_ITEMS) {
    const evictCount = Math.max(1, Math.floor(MAX_ITEMS * EVICT_BATCH_RATIO))
    const sorted = Array.from(store.values()).sort((a, b) => a.capturedAt - b.capturedAt)
    for (let i = 0; i < evictCount && i < sorted.length; i++) {
      store.delete(sorted[i].id)
    }
  }
  const id = nextId++
  store.set(id, { id, content, dataType, capturedAt: Date.now() })
  return id
}

export function getSensitiveItems(): SensitiveItem[] {
  evictExpired()
  return Array.from(store.values()).sort((a, b) => b.capturedAt - a.capturedAt)
}

export function getSensitiveItemById(id: number): SensitiveItem | undefined {
  const item = store.get(id)
  if (!item) return undefined
  if (Date.now() - item.capturedAt > TTL_MS) {
    store.delete(id)
    return undefined
  }
  return item
}

export function removeSensitiveItem(id: number): void {
  store.delete(id)
}

export function clearSensitiveItems(): void {
  store.clear()
}

// Periodic sweep. Independent of read-time eviction so the map can't pile up
// during long idle periods (e.g. the user copied a credential then walked
// away for an hour). The timer is unref'd so it never blocks process exit.
export function startEvictionTimer(): void {
  if (evictionTimer) return
  evictionTimer = setInterval(() => evictExpired(), 60_000)
  if (typeof (evictionTimer as { unref?: () => void }).unref === 'function') {
    (evictionTimer as { unref: () => void }).unref()
  }
}

export function stopEvictionTimer(): void {
  if (evictionTimer) {
    clearInterval(evictionTimer)
    evictionTimer = null
  }
}
