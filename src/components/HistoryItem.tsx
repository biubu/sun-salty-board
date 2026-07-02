import { useState, useEffect } from 'react'
import { ClipboardItem } from '../App'

type HistoryItemProps = {
  item: ClipboardItem
  isActive: boolean
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

export default function HistoryItem({ item, isActive, onSelect, onDelete, onToggleFavorite }: HistoryItemProps) {
  const [showUndo, setShowUndo] = useState(false)
  const [deletedId, setDeletedId] = useState<number | null>(null)

  useEffect(() => {
    if (!showUndo || deletedId === null) return
    const timer = setTimeout(() => {
      setShowUndo(false)
      setDeletedId(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [showUndo, deletedId])

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr + 'Z')
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    return date.toLocaleDateString()
  }

  const typeLabel = item.dataType === 'richtext' ? 'Rich Text'
    : item.dataType.charAt(0).toUpperCase() + item.dataType.slice(1)

  const imageSrc = item.imageData
    ? `data:image/png;base64,${arrayBufferToBase64(item.imageData)}`
    : null

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletedId(item.id)
    setShowUndo(true)
    onDelete(item.id)
  }

  const handleUndo = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await window.electronAPI.undoDelete()
    setShowUndo(false)
    setDeletedId(null)
  }

  if (showUndo && deletedId === item.id) {
    return (
      <div className="history-item undo-bar" onClick={handleUndo}>
        <span>Item deleted</span>
        <button className="action-btn undo" onClick={handleUndo}>Undo</button>
      </div>
    )
  }

  return (
    <div className={`history-item${isActive ? ' active' : ''}`} onClick={() => onSelect(item)}>
      <div className="history-item-content">
        {item.dataType === 'image' && imageSrc ? (
          <img className="history-item-image" src={imageSrc} alt="Clipboard" />
        ) : item.dataType === 'files' ? (
          <div className="history-item-text">
            {item.filePaths?.map((f) => f.split('/').pop() || f).join('\n')}
          </div>
        ) : (
          <div className="history-item-text">{item.content.substring(0, 200)}</div>
        )}
        <div className="history-item-meta">
          <span className="history-item-type">{typeLabel}</span>
          <span className="history-item-time">{formatTime(item.createdAt)}</span>
          {item.sourceDevice && (
            <span className="history-item-type">from {item.sourceDevice}</span>
          )}
        </div>
      </div>
      <div className="history-item-actions">
        <button
          className={`action-btn ${item.isFavorite ? 'favorite' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.id) }}
          title={item.isFavorite ? 'Unfavorite' : 'Favorite'}
        >
          {item.isFavorite ? '\u2605' : '\u2606'}
        </button>
        <button
          className="action-btn delete"
          onClick={handleDelete}
          title="Delete"
        >
          \u2715
        </button>
      </div>
    </div>
  )
}

function arrayBufferToBase64(buffer: number[] | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
