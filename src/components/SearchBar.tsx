import { useEffect, useRef } from 'react'
import { useI18n } from '../utils/i18n'

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <input
      ref={inputRef}
      className="search-bar"
      type="text"
      placeholder={t('search.placeholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
