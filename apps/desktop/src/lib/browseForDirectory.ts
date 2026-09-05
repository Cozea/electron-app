/**
 * Opens the native directory picker and returns the chosen path, or null when
 * the dialog is dismissed.
 *
 * Domain-neutral on purpose: this used to live in the project import module,
 * which meant devapps, settings and workspace all imported a project feature to
 * open a folder dialog. It is a wrapper over one Electron call and belongs to
 * nobody in particular.
 */
export async function browseForDirectory(title: string): Promise<string | null> {
  const result = await window.electronAPI.dialog.selectDirectory({ title })
  if (!result.success || !result.path) {
    return null
  }
  return result.path
}
