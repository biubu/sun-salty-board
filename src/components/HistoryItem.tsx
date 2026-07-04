import { useState, useEffect, useMemo } from 'react'
import { ClipboardItem } from '../types/clipboard'
import { useI18n, useNow } from '../utils/i18n'
import { imageRef, imageUnref } from '../utils/imageUrl'

type HistoryItemProps = {
  item: ClipboardItem
  isActive: boolean
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

export default function HistoryItem({ item, isActive, onSelect, onDelete, onToggleFavorite }: HistoryItemProps) {
  const { t } = useI18n()
  const now = useNow()
  const [showUndo, setShowUndo] = useState(false)
  const [deletedId, setDeletedId] = useState<number | null>(null)

  // Build the blob URL once per (buffer, mime, dataType) tuple. The cleanup
  // revokes the URL when this row unmounts or the inputs change, which is
  // the only state we need — imageUrl.ts keeps no shared registry, so the
  // hookup is strictly local.
  const imageSrc = useMemo(() => {
    const buf = item.imageData
    if (!buf || item.dataType !== 'image') return null
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    return imageRef(bytes, item.imageMime)
  }, [item.imageData, item.imageMime, item.dataType])

  useEffect(() => {
    if (!imageSrc) return
    return () => imageUnref(imageSrc)
  }, [imageSrc])

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
    // DB stores created_at in UTC via SQLite's strftime(... 'now'), which is
    // UTC by definition. Parse as UTC; fall back to local interpretation if
    // the timestamp already carries an explicit offset.
    const date = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)
      ? new Date(normalized)
      : new Date(normalized + 'Z')
    const ts = date.getTime()
    if (Number.isNaN(ts)) return ''
    const diffMs = now.getTime() - ts
    // Future timestamps (clock skew, local DB writes) clamp to "just now"
    // rather than producing negative minute counts.
    if (diffMs < 0) return t('item.just_now')
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return t('item.just_now')
    if (diffMin < 60) return t('item.min_ago', { n: diffMin })
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return t('item.hour_ago', { n: diffHr })
    return date.toLocaleDateString()
  }

  const typeLabel = item.dataType === 'richtext'
    ? t('item.rich_text')
    : item.dataType.charAt(0).toUpperCase() + item.dataType.slice(1)

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
          <img className="history-item-image" src={imageSrc} alt="Clipboard" loading="lazy" />
        ) : item.dataType === 'files' ? (
          <div className="history-item-files">
            <div className="history-item-text">
              {(item.filePaths?.length ?? 0) > 1
                ? t('item.files_count', { n: item.filePaths?.length ?? 0 })
                : (item.filePaths?.[0]?.split('/').pop() ?? '')}
            </div>
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
