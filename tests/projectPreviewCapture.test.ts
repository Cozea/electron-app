import { describe, expect, it } from 'vitest'

import { isLikelyBlankPreviewImageData } from '@/lib/captureProjectPreview'

function createPixels(
  width: number,
  height: number,
  fill: [number, number, number, number]
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4
    pixels[offset] = fill[0]
    pixels[offset + 1] = fill[1]
    pixels[offset + 2] = fill[2]
    pixels[offset + 3] = fill[3]
  }

  return pixels
}

function paintRect(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: [number, number, number, number]
): void {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      const offset = (row * width + column) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = color[3]
    }
  }
}

describe('isLikelyBlankPreviewImageData', () => {
  it('flags a pure white screenshot as blank', () => {
    const pixels = createPixels(120, 80, [255, 255, 255, 255])

    expect(isLikelyBlankPreviewImageData(pixels, 120, 80)).toBe(true)
  })

  it('keeps screenshots with centered content', () => {
    const pixels = createPixels(120, 80, [255, 255, 255, 255])
    paintRect(pixels, 120, 24, 26, 72, 16, [24, 32, 48, 255])

    expect(isLikelyBlankPreviewImageData(pixels, 120, 80)).toBe(false)
  })

  it('keeps non-white layouts', () => {
    const pixels = createPixels(120, 80, [21, 28, 43, 255])

    expect(isLikelyBlankPreviewImageData(pixels, 120, 80)).toBe(false)
  })
})
