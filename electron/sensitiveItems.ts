interface SensitiveItem {
  id: number
  content: string
  dataType: string
  capturedAt: number
}

let nextId = 1
const store: Map<number, SensitiveItem> = new Map()

export function addSensitiveItem(
  content: string,
  dataType: string,
): number {
  const id = nextId++
  store.set(id, { id, content, dataType, capturedAt: Date.now() })
  return id
}

export function getSensitiveItems(): SensitiveItem[] {
  return Array.from(store.values()).sort((a, b) => b.capturedAt - a.capturedAt)
}

export function getSensitiveItemById(id: number): SensitiveItem | undefined {
  return store.get(id)
}

export function removeSensitiveItem(id: number): void {
  store.delete(id)
}

export function clearSensitiveItems(): void {
  store.clear()
}
