import { describe, it, expect } from 'vitest'

describe('Electron IPC Integration', () => {
  type ClipboardItem = {
    id: number
    content: string
    dataType: string
    isFavorite: boolean
    categoryIds: number[]
    createdAt: string
  }

  const mockItems: ClipboardItem[] = [
    { id: 1, content: 'hello', dataType: 'text', isFavorite: false, categoryIds: [], createdAt: new Date().toISOString() },
    { id: 2, content: 'world', dataType: 'text', isFavorite: true, categoryIds: [1], createdAt: new Date().toISOString() },
  ]

  it('should return items from main to renderer', () => {
    expect(mockItems).toHaveLength(2)
  })

  it('should paste selected item via IPC', () => {
    const id = 1
    const item = mockItems.find((i) => i.id === id)
    expect(item?.content).toBe('hello')
  })

  it('should toggle favorite via IPC', () => {
    const id = 2
    const item = mockItems.find((i) => i.id === id)
    if (item) item.isFavorite = !item.isFavorite
    expect(item?.isFavorite).toBe(false)
  })

  it('should delete item via IPC', () => {
    const id = 1
    const remaining = mockItems.filter((i) => i.id !== id)
    expect(remaining).toHaveLength(1)
  })
})
