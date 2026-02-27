export const DIAGNOSTICS_REFRESH_EVENT_NAME = 'vscode-diagnostics:refresh'

export function requestEditorDiagnosticsRefresh(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(DIAGNOSTICS_REFRESH_EVENT_NAME))
}
