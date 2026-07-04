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
  const { t, setLocale } = useContext(I18nContext)
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
        // Renderer passes the raw digit; main.ts treats the value as a
        // 1-based position so "press 1 → paste first item".
        window.electronAPI.pasteByIndex(parseInt(e.key, 10))
      } else if (e.key === '0') {
        window.electronAPI.pasteByIndex(0)
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
        <div className="app-header-row">
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
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
            // delete-item IPC handler pushes a `history-update` broadcast,
            // which the App-level onHistoryUpdate subscription above already
            // applies to setItems. An explicit getHistory() here would race
            // with that push and is unnecessary.
            window.electronAPI.deleteItem(id)
          }}
          onToggleFavorite={(id) => {
            // Same as onDelete — toggle-favorite pushes history-update.
            window.electronAPI.toggleFavorite(id)
          }}
        />
      </main>
    </div>
  )
}
