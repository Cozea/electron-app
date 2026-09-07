/** Registered by the application-scoped host, invoked after renderer unload
 * guards succeed and before the workspace catalog/native services are disposed. */
let shutdown: (() => Promise<void>) | null = null
export function registerCollaborationShutdown(handler: () => Promise<void>): void { shutdown = handler }
export async function shutdownCollaboration(): Promise<void> { await shutdown?.() }
