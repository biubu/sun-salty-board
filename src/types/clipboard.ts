export type DataType = 'text' | 'richtext' | 'image' | 'files'

export interface ClipboardItem {
  id: number
  content: string
  contentHtml?: string
  dataType: DataType
  imageData?: Uint8Array | number[]
  imageMime?: string
  filePaths?: string[]
  sourceApp?: string
  sourceDevice?: string
  categoryIds: number[]
  isFavorite: boolean
  createdAt: string
}

export interface Category {
  id: number
  name: string
}

export interface Settings {
  maxItems: number
  hotkey: string
  expirationDays: number
  theme: 'light' | 'dark'
  locale: string
  exclusionApps: string[]
  exclusionPatterns: string[]
}

export interface SensitiveItem {
  id: number
  content: string
  dataType: string
  capturedAt: number
}
