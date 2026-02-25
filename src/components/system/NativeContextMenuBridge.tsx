import { useEffect } from 'react'

function isEditableTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement) {
    return !target.readOnly && !target.disabled
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled
  }

  if (target.isContentEditable) return true

  const editableAncestor = target.closest('[contenteditable="true"]')
  if (editableAncestor) return true

  const role = target.getAttribute('role')
  return role === 'textbox'
}

function getLinkUrl(target: HTMLElement): string | undefined {
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (!anchor?.href) return undefined
  return anchor.href
}

export function NativeContextMenuBridge() {
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 2) return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-native-context-menu="off"]')) return

      const editable = isEditableTarget(target)
      const selectionText = window.getSelection()?.toString() ?? ''
      const linkUrl = getLinkUrl(target)

      if (!editable && !selectionText.trim() && !linkUrl) {
        return
      }

      event.preventDefault()

      void window.electronAPI.contextMenu.showNative({
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        editable,
        selectionText,
        linkUrl,
      })
    }

    document.addEventListener('contextmenu', handleContextMenu)
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [])

  return null
}
