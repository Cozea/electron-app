#!/usr/bin/env node
// Temporary isolated-checkout integration driver; remove after verification.
import fs from "node:fs";
const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one recovery integration anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}
const projection = "apps/desktop/electron/collaboration/SessionFileProjection.ts";
replace(projection, '  store: Pick<DurableSessionStore, "readProjection" | "saveProjection">', '  store: Pick<DurableSessionStore, "readProjection" | "saveProjection"> & Partial<Pick<DurableSessionStore, "reserveProjectionWrite">>');
replace(projection, '      if (bytes > 96 * 1024 * 1024)', '      if (bytes + Buffer.byteLength(expected?.content ?? "") > 96 * 1024 * 1024)');
replace(projection, '        await fs.rename(await this.filename(oldPath), backup)', `        const source = await this.filename(oldPath)
        const retain = () => fs.rename(source, backup)
        if (this.options.store.reserveProjectionWrite) await this.options.store.reserveProjectionWrite((await fs.lstat(source)).size, retain)
        else await retain()`);
replace(projection, `        const handle = await fs.open(staging, "wx", after.executable ? 0o755 : 0o644)
        try { await handle.writeFile(after.content, "utf8"); await handle.sync() } finally { await handle.close() }
        // Hard-link is an atomic create-if-absent; it cannot replace a racing
        // external write and readers never observe a half-written projection.
        await fs.link(staging, filename)
        await fs.unlink(staging)`, `        const materialize = async () => {
          const handle = await fs.open(staging, "wx", after.executable ? 0o755 : 0o644)
          try { await handle.writeFile(after.content, "utf8"); await handle.sync() } finally { await handle.close() }
          // Hard-link is an atomic create-if-absent; it cannot replace a racing
          // external write and readers never observe a half-written projection.
          await fs.link(staging, filename)
          await fs.unlink(staging)
        }
        if (this.options.store.reserveProjectionWrite) await this.options.store.reserveProjectionWrite(Buffer.byteLength(after.content), materialize)
        else await materialize()`);
replace("shared/collaborationRuntime.ts", 'export interface CollaborationRuntimeAPI {', 'export interface CollaborationRuntimeAPI {\n  recoveryInventory(): Promise<import("./collaborationRecovery").CollaborationRecoveryInventory>\n  cleanupRecovery(sessionId: string): Promise<import("./collaborationRecovery").CollaborationRecoveryCleanupResult>');
const host = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
replace(host, 'import path from "node:path"', 'import path from "node:path"\nimport { inventoryRecoveryStorage } from "./RecoveryStorageBudget"\nimport { compactVerifiedRecoveryStore } from "./RecoveryStorageCleanup"\nimport { COLLABORATION_RECOVERY_LIMIT_BYTES, COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES, type CollaborationRecoveryInventory, type CollaborationRecoveryCleanupResult } from "../../../../shared/collaborationRecovery"');
replace(host, '  async retry(sessionId: string): Promise<void> {', `  async recoveryInventory(): Promise<CollaborationRecoveryInventory> {
    return { ...await inventoryRecoveryStorage(this.root), limitBytes: COLLABORATION_RECOVERY_LIMIT_BYTES, roomLimitBytes: COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES }
  }

  async cleanupRecovery(sessionId: string): Promise<CollaborationRecoveryCleanupResult> {
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding || binding.generation !== 3) throw new Error("Catalog-owned session recovery is unavailable")
    const policy = await this.coordinator.bindingForWorkspace(binding.workspaceId)
    if (policy?.sessionId !== sessionId || policy.projectId !== binding.projectId) throw new Error("Recovery workspace association is invalid")
    const versions = await this.keys.versions(sessionId)
    if (versions.length > 64) throw new Error("Recovery cleanup exceeds its bounded key inventory; all data was retained")
    const result = { files: 0, bytes: 0 }
    for (const version of versions) {
      const key = await this.keys.recoverKey(binding.projectId, sessionId, version)
      if (!key) continue
      const cleaned = await compactVerifiedRecoveryStore({ root: this.root, roomId: key.session.roomId, projectId: binding.projectId, sessionId, keyVersion: key.keyVersion, roomKeyBase64: key.roomKeyBase64 })
      result.files += cleaned.files; result.bytes += cleaned.bytes
    }
    return result
  }

  async retry(sessionId: string): Promise<void> {`);
const handlers = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts";
replace(handlers, '      setup: id => host.setup(id),', '      recoveryInventory: () => host.recoveryInventory(),\n      cleanupRecovery: id => host.cleanupRecovery(id),\n      setup: id => host.setup(id),');
replace(handlers, '  ipcMain.handle("collaboration:runtimeSetup", authorized(api.runtime.setup))', '  ipcMain.handle("collaboration:runtimeRecoveryInventory", authorized(api.runtime.recoveryInventory))\n  ipcMain.handle("collaboration:runtimeCleanupRecovery", authorized(api.runtime.cleanupRecovery))\n  ipcMain.handle("collaboration:runtimeSetup", authorized(api.runtime.setup))');
replace("apps/desktop/electron/preload.ts", '      setup: id => ipcRenderer.invoke("collaboration:runtimeSetup", id),', '      recoveryInventory: () => ipcRenderer.invoke("collaboration:runtimeRecoveryInventory"),\n      cleanupRecovery: id => ipcRenderer.invoke("collaboration:runtimeCleanupRecovery", id),\n      setup: id => ipcRenderer.invoke("collaboration:runtimeSetup", id),');
const ui = "apps/desktop/src/features/collaboration/ProjectCollaborationControl.tsx";
replace(ui, 'import { CollaborationBinaryPicker } from "./CollaborationBinaryPicker"', 'import { CollaborationBinaryPicker } from "./CollaborationBinaryPicker"\nimport { CollaborationRecoveryPanel } from "./CollaborationRecoveryPanel"');
replace(ui, '        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}', '        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}\n        <CollaborationRecoveryPanel sessionId={sessionId ?? retainedId} disabled={busy} />');
for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}
