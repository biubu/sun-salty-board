import { useMemo } from 'react'
import { List, type RowComponentProps } from 'react-window'
import { AutoSizer } from 'react-virtualized-auto-sizer'
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

// react-window 2.x row props: the List merges `rowProps` with its built-in
// row-rendering props (`index`, `style`, `ariaAttributes`). We bundle the
// actual items + selectedIndex + stable callbacks into one object so the
// row component never closes over stale values.
//
// React-window 2 still does a shallow compare on `rowProps` to decide
// whether to re-render rows, so we keep the useMemo wrapper to avoid
// thrashing the row on every keystroke during search.
type RowData = {
  items: ClipboardItem[]
  selectedIndex: number
  onSelect: (item: ClipboardItem) => void
  onDelete: (id: number) => void
  onToggleFavorite: (id: number) => void
}

function Row({
  index,
  style,
  ariaAttributes,
  items,
  selectedIndex,
  onSelect,
  onDelete,
  onToggleFavorite,
}: RowComponentProps<RowData>) {
  const item = items[index]
  return (
    <div style={style} {...ariaAttributes}>
      <HistoryItem
        item={item}
        isActive={index === selectedIndex}
        onSelect={onSelect}
        onDelete={onDelete}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  )
}

// AutoSizer 2.x dropped the function-child API in favour of an explicit
// `ChildComponent` prop. The component also passes `height`/`width` as
// `undefined` on the very first render (server-render or before the
// ResizeObserver fires), so the wrapper early-returns until the
// measurement lands — otherwise List gets NaN dimensions and crashes.
type ListChildProps = { height: number | undefined; width: number | undefined }

export default function HistoryPanel({ items, selectedIndex, onSelect, onDelete, onToggleFavorite }: HistoryPanelProps) {
  const { t } = useI18n()

  const rowProps = useMemo<RowData>(() => ({
    items, selectedIndex, onSelect, onDelete, onToggleFavorite,
  }), [items, selectedIndex, onSelect, onDelete, onToggleFavorite])

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <span>{t('empty.no_history')}</span>
        <span>{t('empty.hint')}</span>
      </div>
    )
  }

  // Define the child component inline so it closes over the latest rowProps
  // and items. React-window's shallow-compare on rowProps still kicks in,
  // and React.memo on ListRenderer prevents re-renders unless dimensions
  // change — measured once per AutoSizer resize, not per keystroke.
  const ListChild = ({ height, width }: ListChildProps) => {
    if (height === undefined || width === undefined) return null
    return (
      <List
        rowCount={items.length}
        rowHeight={ITEM_HEIGHT}
        rowComponent={Row}
        rowProps={rowProps}
        style={{ height, width }}
      />
    )
  }

  return (
    <div className="history-list">
      <AutoSizer ChildComponent={ListChild} />
    </div>
  )
}