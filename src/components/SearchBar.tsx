import { useEffect, useRef } from 'react'

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
}

export default function SearchBar({ value, onChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <input
      ref={inputRef}
      className="search-bar"
      type="text"
      placeholder="Search clipboard history..."
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
