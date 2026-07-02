import { useState, useEffect, useMemo, useRef } from 'react'
import HistoryPanel from './components/HistoryPanel'
import SearchBar from './components/SearchBar'
import FilterChips from './components/FilterChips'
import SettingsPanel from './components/SettingsPanel'

export interface ClipboardItem {
  id: number
  content: string
  contentHtml?: string
  dataType: 'text' | 'richtext' | 'image' | 'files'
  imageData?: number[]
  filePaths?: string[]
  sourceApp?: string
  sourceDevice?: string
  categoryIds: number[]
  isFavorite: boolean
  createdAt: string
}

export type FilterType = 'all' | 'text' | 'richtext' | 'image' | 'files' | 'favorites'

export default function App() {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex

  useEffect(() => {
    window.electronAPI.getHistory().then(setItems)
    const unsub1 = window.electronAPI.onHistoryUpdate(setItems)
    const unsub2 = window.electronAPI.onOpenSettings(() => setShowSettings(true))
    return () => { unsub1(); unsub2() }
  }, [])

  const filteredItems = useMemo(() => {
    let result = items
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((item) => item.content.toLowerCase().includes(q))
    }
    if (activeFilter === 'favorites') {
      result = result.filter((item) => item.isFavorite)
    } else if (activeFilter !== 'all') {
      result = result.filter((item) => item.dataType === activeFilter)
    }
    if (selectedCategoryId !== null) {
      result = result.filter((item) => item.categoryIds.includes(selectedCategoryId))
    }
    return result
  }, [items, searchQuery, activeFilter, selectedCategoryId])

  const filteredRef = useRef(filteredItems)
  filteredRef.current = filteredItems

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key >= '1' && e.key <= '9') {
        window.electronAPI.pasteByIndex(parseInt(e.key, 10))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i > 0 ? i - 1 : filteredRef.current.length - 1))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i < filteredRef.current.length - 1 ? i + 1 : 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filteredRef.current[selectedIndexRef.current]
        if (item) window.electronAPI.pasteItem(item.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (showSettings) {
    return <SettingsPanel onClose={() => setShowSettings(false)} />
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
        <FilterChips
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          selectedCategoryId={selectedCategoryId}
          onCategoryChange={setSelectedCategoryId}
        />
      </header>
      <main className="app-main">
        <HistoryPanel
          items={filteredItems}
          selectedIndex={selectedIndex}
          onSelect={(item) => window.electronAPI.pasteItem(item.id)}
          onDelete={(id) => {
            window.electronAPI.deleteItem(id)
            window.electronAPI.getHistory().then(setItems)
          }}
          onToggleFavorite={(id) => {
            window.electronAPI.toggleFavorite(id)
            window.electronAPI.getHistory().then(setItems)
          }}
        />
      </main>
    </div>
  )
}
