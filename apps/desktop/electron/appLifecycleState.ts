let applicationQuitting = false

export function markApplicationQuitting(): void {
  applicationQuitting = true
}

export function isApplicationQuitting(): boolean {
  return applicationQuitting
}

export function shouldPreserveWindowlessRuntime(
  platform: NodeJS.Platform = process.platform,
  quitting: boolean = applicationQuitting,
): boolean {
  return platform === 'darwin' && !quitting
}
