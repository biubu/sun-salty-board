import { useState, useEffect } from 'react'
import { FilterType } from '../App'
import type { Category } from '../types/clipboard'
import { useI18n } from '../utils/i18n'

const FILTERS: { key: FilterType; i18nKey: string }[] = [
  { key: 'all', i18nKey: 'filter.all' },
  { key: 'text', i18nKey: 'filter.text' },
  { key: 'image', i18nKey: 'filter.images' },
  { key: 'files', i18nKey: 'filter.files' },
  { key: 'favorites', i18nKey: 'filter.favorites' },
]

type FilterChipsProps = {
  activeFilter: FilterType
  onFilterChange: (filter: FilterType) => void
  selectedCategoryId: number | null
  onCategoryChange: (id: number | null) => void
}

export default function FilterChips({ activeFilter, onFilterChange, selectedCategoryId, onCategoryChange }: FilterChipsProps) {
  const { t } = useI18n()
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    window.electronAPI.getCategories().then(setCategories)
  }, [])

  return (
    <div className="filter-chips">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          className={`filter-chip ${activeFilter === f.key ? 'active' : ''}`}
          onClick={() => onFilterChange(f.key)}
        >
          {t(f.i18nKey)}
        </button>
      ))}
      {categories.map((cat) => (
        <button
          key={cat.id}
          className={`filter-chip ${selectedCategoryId === cat.id ? 'active' : ''}`}
          onClick={() => onCategoryChange(selectedCategoryId === cat.id ? null : cat.id)}
        >
          {cat.name}
        </button>
      ))}
    </div>
  )
}
