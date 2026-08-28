export interface DevServerPreviewTarget {
  selector?: string
  locator?: string
}

export interface DevServerPreviewElement {
  tag: string
  role: string | null
  name: string
  selector: string
  x: number
  y: number
  width: number
  height: number
}

export interface DevServerPreviewSnapshotResult {
  url: string
  title: string
  loading: boolean
  visibleText: string
  interactiveElements: DevServerPreviewElement[]
  accessibilityTree: unknown
  screenshot: {
    mimeType: 'image/png'
    data: string
    width: number
    height: number
  }
}

export interface DevServerPreviewActionResult {
  ok: boolean
  error?: 'not_found' | 'not_editable' | 'invalid_selector' | 'timeout'
  message?: string
}

export interface DevServerPreviewClickInput extends DevServerPreviewTarget {
  tileId: string
  x?: number
  y?: number
}

export interface DevServerPreviewTypeInput extends DevServerPreviewTarget {
  tileId: string
  text: string
  clear?: boolean
}

export interface DevServerPreviewPressInput {
  tileId: string
  key: string
  modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>
}

export interface DevServerPreviewScrollInput extends DevServerPreviewTarget {
  tileId: string
  deltaX?: number
  deltaY?: number
}

export interface DevServerPreviewWaitForInput extends DevServerPreviewTarget {
  tileId: string
  text?: string
  urlIncludes?: string
  timeoutMs?: number
}
