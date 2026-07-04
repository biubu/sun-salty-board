import { useState, useEffect, useMemo, useRef, useContext } from 'react'
import HistoryPanel from './components/HistoryPanel'
import SearchBar from './components/SearchBar'
import FilterChips from './components/FilterChips'
import SettingsPanel from './components/SettingsPanel'
import { I18nContext, type Locale } from './utils/i18n'
import type { ClipboardItem } from './types/clipboard'

export type FilterType = 'all' | 'text' | 'richtext' | 'image' | 'files' | 'favorites'

export default function App() {
  const [items, setItems] = useState<ClipboardItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  // Debounced query that drives the (possibly IPC-backed) filter pipeline.
  // Keeping the raw `searchQuery` lets the <input> stay responsive on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const { setLocale } = useContext(I18nContext)
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex

  useEffect(() => {
    window.electronAPI.getHistory().then(setItems)
    const unsub1 = window.electronAPI.onHistoryUpdate(setItems)
    const unsub2 = window.electronAPI.onOpenSettings(() => setShowSettings(true))
    return () => { unsub1(); unsub2() }
  }, [])

  useEffect(() => {
    window.electronAPI.getSettings().then((s) => {
      document.documentElement.setAttribute('data-theme', s.theme)
      setLocale((s.locale as Locale) || 'en')
    })
  }, [setLocale])

  // 200ms debounce so a fast typist doesn't refilter the whole list on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 200)
    return () => clearTimeout(id)
  }, [searchQuery])

  const filteredItems = useMemo(() => {
    let result = items
    if (debouncedQuery) {
      const q = debouncedQuery.toLowerCase()
      result = result.filter((item) => item.content.toLowerCase().includes(q))
    }
    if (activeFilter === 'favorites') {
      result = result.filter((item) => item.isFavorite)
    } else if (activeFilter === 'text') {
      result = result.filter((item) => item.dataType === 'text' || item.dataType === 'richtext')
    } else if (activeFilter !== 'all') {
      result = result.filter((item) => item.dataType === activeFilter)
    }
    if (selectedCategoryId !== null) {
      result = result.filter((item) => item.categoryIds.includes(selectedCategoryId))
    }
    return result
  }, [items, debouncedQuery, activeFilter, selectedCategoryId])

  // Reset selection when filters change so we never point past the end of the list.
  useEffect(() => {
    setSelectedIndex((i) => (i >= filteredItems.length ? 0 : i))
  }, [filteredItems.length])

  const filteredRef = useRef(filteredItems)
  filteredRef.current = filteredItems

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
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
