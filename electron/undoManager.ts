interface UndoEntry {
  table: string
  rowId: number
  data: Record<string, unknown>
}

const UNDO_DURATION = 5000
let pendingUndo: UndoEntry | null = null
let undoTimeout: ReturnType<typeof setTimeout> | null = null

export function prepareUndo(
  table: string,
  rowId: number,
  data: Record<string, unknown>,
): void {
  clearPending()
  pendingUndo = { table, rowId, data }
  undoTimeout = setTimeout(() => {
    pendingUndo = null
    undoTimeout = null
  }, UNDO_DURATION)
}

export function getPendingUndo(): UndoEntry | null {
  return pendingUndo
}

export function consumeUndo(): UndoEntry | null {
  const entry = pendingUndo
  clearPending()
  return entry
}

export function clearPending(): void {
  if (undoTimeout) {
    clearTimeout(undoTimeout)
    undoTimeout = null
  }
  pendingUndo = null
}
