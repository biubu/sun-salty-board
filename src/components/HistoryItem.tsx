import { useState, useEffect } from 'react'
import { ClipboardItem } from '../App'
import { useI18n } from '../utils/i18n'

type HistoryItemProps = {
  item: ClipboardItem
  isActive: boolean
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

export default function HistoryItem({ item, isActive, onSelect, onDelete, onToggleFavorite }: HistoryItemProps) {
  const { t } = useI18n()
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
    const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T')
    const date = new Date(normalized + 'Z')
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return t('item.just_now')
    if (diffMin < 60) return t('item.min_ago', { n: diffMin })
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return t('item.hour_ago', { n: diffHr })
    return date.toLocaleDateString()
  }

  const typeLabel = item.dataType === 'richtext' ? t('item.rich_text')
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
        <span>{t('item.deleted')}</span>
        <button className="action-btn undo" onClick={handleUndo}>{t('item.undo')}</button>
      </div>
    )
  }

  return (
    <div className={`history-item${isActive ? ' active' : ''}`} onClick={() => onSelect(item)}>
      <div className="history-item-content">
        {item.dataType === 'image' && imageSrc ? (
          <img className="history-item-image" src={imageSrc} alt="Clipboard" />
        ) : item.dataType === 'files' ? (
          <div className="history-item-files">
            <div className="history-item-text">{(item.filePaths?.length ?? 0) > 1 ? t('item.files_count', { n: item.filePaths?.length ?? 0 }) : (item.filePaths?.[0]?.split('/').pop() ?? '')}</div>
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
          title={item.isFavorite ? t('item.unfavorite') : t('item.favorite')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={item.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
        <button
          className="action-btn delete"
          onClick={handleDelete}
          title={t('item.delete')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
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
