import { useCallback } from 'react'
import { FixedSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import { ClipboardItem } from '../App'
import HistoryItem from './HistoryItem'
import { useI18n } from '../utils/i18n'

type HistoryPanelProps = {
  items: ClipboardItem[]
  selectedIndex: number
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

const ITEM_HEIGHT = 94

export default function HistoryPanel({ items, selectedIndex, onSelect, onDelete, onToggleFavorite }: HistoryPanelProps) {
  const { t } = useI18n()
  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = items[index]
      return (
        <div style={style}>
          <HistoryItem
            item={item}
            isActive={index === selectedIndex}
            onSelect={onSelect}
            onDelete={onDelete}
            onToggleFavorite={onToggleFavorite}
          />
        </div>
      )
    },
    [items, selectedIndex, onSelect, onDelete, onToggleFavorite],
  )

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <span>{t('empty.no_history')}</span>
        <span>{t('empty.hint')}</span>
      </div>
    )
  }

  return (
    <div className="history-list">
      <AutoSizer>
        {({ height, width }) => (
          <List
            height={height}
            width={width}
            itemCount={items.length}
            itemSize={ITEM_HEIGHT}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  )
}
