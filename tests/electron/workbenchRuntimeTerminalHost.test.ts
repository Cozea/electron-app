import { describe, expect, it } from 'vitest'

import {
  resolveTerminalResize,
  sanitizeTerminalHistoryChunk,
  shouldSuppressResizeHistoryChunk,
} from '../../apps/desktop/electron/workbench-runtime/terminalHost'

describe('workbench runtime terminal history', () => {
  it('preserves ANSI styling while stripping terminal query responses from replay history', () => {
    const result = sanitizeTerminalHistoryChunk(
      '',
      'plain \u001b[31mred\u001b[0m\u001b[?1;2c after\u001b[6n',
    )

    expect(result.visibleText).toBe('plain \u001b[31mred\u001b[0m after')
    expect(result.pendingControlSequence).toBe('')
  })

  it('carries an incomplete control sequence into the next chunk', () => {
    const first = sanitizeTerminalHistoryChunk('', 'before \u001b[31')
    const second = sanitizeTerminalHistoryChunk(first.pendingControlSequence, 'mred')

    expect(first.visibleText).toBe('before ')
    expect(first.pendingControlSequence).toBe('\u001b[31')
    expect(second.visibleText).toBe('\u001b[31mred')
    expect(second.pendingControlSequence).toBe('')
  })

  it('strips OSC color query sequences but keeps other OSC sequences', () => {
    const result = sanitizeTerminalHistoryChunk(
      '',
      'a\u001b]10;?\u0007b\u001b]0;Window title\u0007c',
    )

    expect(result.visibleText).toBe('ab\u001b]0;Window title\u0007c')
    expect(result.pendingControlSequence).toBe('')
  })

  it('treats identical terminal dimensions as a no-op resize', () => {
    expect(resolveTerminalResize({ cols: 120, rows: 30 }, { cols: 120, rows: 30 })).toBeNull()
    expect(resolveTerminalResize({ cols: 120, rows: 30 }, { cols: 121.8, rows: 30 })).toEqual({
      cols: 121,
      rows: 30,
    })
  })

  it('suppresses single-line resize redraw chunks from persisted history only', () => {
    expect(shouldSuppressResizeHistoryChunk('\r\u001b[Kadmin@host project %')).toBe(true)
    expect(shouldSuppressResizeHistoryChunk('build complete\n')).toBe(false)
  })
})
