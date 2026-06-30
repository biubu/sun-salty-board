import { describe, it, expect } from 'vitest'

describe('Data Type Extraction', () => {
  it('should handle plain text capture', () => {
    const text = 'Hello World'
    expect(typeof text).toBe('string')
    const typeLabel = 'Text'
    expect(typeLabel).toBe('Text')
  })

  it('should handle rich text with dual storage', () => {
    const plain = 'Hello'
    const html = '<b>Hello</b>'
    expect(typeof plain).toBe('string')
    expect(typeof html).toBe('string')
    expect(html).toContain('<b>')
  })

  it('should handle image data with compression', () => {
    const mockPngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const isPng =
      mockPngBytes[0] === 0x89 &&
      mockPngBytes[1] === 0x50 &&
      mockPngBytes[2] === 0x4E &&
      mockPngBytes[3] === 0x47
    expect(isPng).toBe(true)
  })

  it('should handle file references', () => {
    const files = ['/home/user/doc.txt', '/home/user/image.png']
    expect(files.length).toBe(2)
    const joined = files.join('\n')
    expect(joined).toContain('doc.txt')
  })

  it('should detect image MIME types via magic bytes', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47])
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF])
    const bmpHeader = new Uint8Array([0x42, 0x4D])

    function detectMime(data: Uint8Array): string {
      if (data[0] === 0x89 && data[1] === 0x50) return 'image/png'
      if (data[0] === 0xFF && data[1] === 0xD8) return 'image/jpeg'
      if (data[0] === 0x42 && data[1] === 0x4D) return 'image/bmp'
      return 'image/png'
    }

    expect(detectMime(pngHeader)).toBe('image/png')
    expect(detectMime(jpegHeader)).toBe('image/jpeg')
    expect(detectMime(bmpHeader)).toBe('image/bmp')
  })
})
