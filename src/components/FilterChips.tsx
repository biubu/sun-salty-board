import { useState, useEffect } from 'react'
import { FilterType } from '../App'
import type { Category } from '../types'

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Images' },
  { key: 'files', label: 'Files' },
  { key: 'favorites', label: 'Favorites' },
]

type FilterChipsProps = {
  activeFilter: FilterType
  onFilterChange: (filter: FilterType) => void
  selectedCategoryId: number | null
  onCategoryChange: (id: number | null) => void
}

export default function FilterChips({ activeFilter, onFilterChange, selectedCategoryId, onCategoryChange }: FilterChipsProps) {
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
          {f.label}
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
