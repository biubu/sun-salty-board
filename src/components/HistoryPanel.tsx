import { useCallback, useMemo } from 'react'
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import type { ClipboardItem } from '../types/clipboard'
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

// react-window itemData: passed straight to the row. We bundle the actual
// items, the selectedIndex, and the parent's stable callbacks so that:
//   * Row never closes over `items` (so we can memoize the row factory)
//   * Changing `selectedIndex` doesn't recreate the row function
//   * callbacks passed from App are stable identity (useCallback up the tree)
type RowData = {
  items: ClipboardItem[]
  selectedIndex: number
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const item = data.items[index]
  return (
    <div style={style}>
      <HistoryItem
        item={item}
        isActive={index === data.selectedIndex}
        onSelect={data.onSelect}
        onDelete={data.onDelete}
        onToggleFavorite={data.onToggleFavorite}
      />
    </div>
  )
}

export default function HistoryPanel({ items, selectedIndex, onSelect, onDelete, onToggleFavorite }: HistoryPanelProps) {
  const { t } = useI18n()

  // Memoize the itemData so react-window's shallow comparison sees a stable
  // reference unless one of the inputs changed. Without this, the Row is
  // re-rendered for every keystroke during search.
  const itemData = useMemo<RowData>(() => ({
    items, selectedIndex, onSelect, onDelete, onToggleFavorite,
  }), [items, selectedIndex, onSelect, onDelete, onToggleFavorite])

  const itemKey = useCallback(
    (index: number, data: RowData) => data.items[index]?.id ?? index,
    [],
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
            itemData={itemData}
            itemKey={itemKey}
          >
            {Row}
          </List>
        )}
      </AutoSizer>
    </div>
  )
}
