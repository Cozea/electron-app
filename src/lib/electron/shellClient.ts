export async function openExternalUrl(url: string): Promise<void> {
  await window.electronAPI.shell.openExternal(url);
}
