const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/TerminalInstance.tsx', 'utf8');

const getTerminalSelectionRect = `function getTerminalSelectionRect(mountElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }

  const range = selection.getRangeAt(0)
  const commonAncestor = range.commonAncestorContainer
  const selectionRoot =
    commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement
  if (!(selectionRoot instanceof Element) || !mountElement.contains(selectionRoot)) {
    return null
  }

  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  )
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null
  }

  const boundingRect = range.getBoundingClientRect()
  return boundingRect.width > 0 || boundingRect.height > 0 ? boundingRect : null
}
`;

file = file.replace(
  "const buildProjectTerminalTheme = (container: HTMLElement) => {",
  getTerminalSelectionRect + "\nconst buildProjectTerminalTheme = (container: HTMLElement) => {"
);

const handleSelectionAction = `
  const handleSelectionAction = useCallback(async () => {
    const term = xtermRef.current
    const container = containerRef.current
    if (!term || !container) return

    const selectionText = term.getSelection()
    const selectionPosition = term.getSelectionPosition()
    const normalizedText = selectionText.replace(/\\r\\n/g, '\\n').replace(/^\\n+|\\n+$/g, '')

    if (!selectionPosition || normalizedText.length === 0) {
      return
    }

    const lineStart = selectionPosition.start.y + 1
    const lineCount = normalizedText.split('\\n').length
    const lineEnd = Math.max(lineStart, lineStart + lineCount - 1)

    const selectionRect = getTerminalSelectionRect(container)
    let x = eventClientPosRef.current.x
    let y = eventClientPosRef.current.y
    if (selectionRect) {
      x = Math.round(selectionRect.right)
      y = Math.round(selectionRect.bottom + 4)
    }

    const result = await window.electronAPI.contextMenu.showTerminalSelection({
      selectedText: normalizedText,
      x,
      y,
    })

    if (result.action === 'askAI') {
      // TODO: rich context
      console.log('Sending to AI:', { terminalId, lineStart, lineEnd, text: normalizedText })
      term.clearSelection()
      term.focus()
    } else if (result.action === 'explainError') {
      console.log('prompt ignored')
      term.clearSelection()
      term.focus()
    }
  }, [terminalId])

  const eventClientPosRef = useRef({ x: 0, y: 0 })
`;

file = file.replace(
  "const getTrimmedSelection = useCallback(() => {",
  handleSelectionAction + "\n  const getTrimmedSelection = useCallback(() => {"
);

// We want to hook this on mouseup. Let's find the container render logic.
file = file.replace(
  /onContextMenu=\{handleContextMenu\}/,
  "onMouseUp={(e) => { eventClientPosRef.current = { x: e.clientX, y: e.clientY }; void handleSelectionAction() }}\n      onContextMenu={(e) => { eventClientPosRef.current = { x: e.clientX, y: e.clientY }; void handleSelectionAction() }}"
);

// Remove the tooltip completely
const tooltipRegex = /      \{selectedText\.trim\(\)\.length > 0 && \([\s\S]*?Ask AI\n            <\/button>\n          <\/TooltipTrigger>\n          <\/TooltipContent>\n        <\/Tooltip>\n      \)\}/;
file = file.replace(
  /      \{selectedText\.trim\(\)\.length > 0 && \([\s\S]*?<\/Tooltip>\n      \}\)\s*/,
  ""
);

fs.writeFileSync('src/features/projects/components/TerminalInstance.tsx', file);
