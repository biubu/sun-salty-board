import { useCallback } from 'react'
import { FixedSizeList as List } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import { ClipboardItem } from '../App'
import HistoryItem from './HistoryItem'

type HistoryPanelProps = {
  items: ClipboardItem[]
  selectedIndex: number
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

const ITEM_HEIGHT = 80

export default function HistoryPanel({ items, selectedIndex, onSelect, onDelete, onToggleFavorite }: HistoryPanelProps) {
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
    [items, onSelect, onDelete, onToggleFavorite],
  )

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <span>No clipboard history</span>
        <span>Copy something to get started</span>
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
