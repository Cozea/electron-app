import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isMainThread, threadId } from 'node:worker_threads';
import {
  desktopStateRecordKey, type DesktopStateNamespace, type DesktopStateRecord,
  type PersistenceAcknowledgement, type PersistenceCommitResult, type PersistenceLoadResult,
  type PersistenceLoadIssue, type PersistenceFlushResult, type LegacyDesktopDomain, type LegacyMigrationResult,
} from '@shared/desktopPersistenceTypes';
import {
  assertPersistenceBatch, assertPersistenceLoad, assertLegacyMigration, isDesktopStateRecord,
  validateDesktopStateData, MAX_QUERY_PERSISTED_BYTES, MAX_PERSISTED_QUERY_ENTRIES, QUERY_CACHE_PERSISTED_BUDGET,
} from '@shared/desktopPersistenceValidation';
import { decodeLegacyDesktopState } from '@shared/legacyDesktopState';

interface WorkerCoreOptions {
  userDataPath: string;
  /** Fault injection for Node tests; this function is never accepted over IPC. */
  beforeReplace?: (record: DesktopStateRecord) => Promise<void>;
}
interface FailedWrite { watermark: number; revision: number; message: string }
interface StoredRecord { record: DesktopStateRecord | null; issue: PersistenceLoadIssue | null }

/** All parsing, serialization and filesystem work belongs to the dedicated Node worker. */
export class DesktopStatePersistenceWorkerCore {
  private readonly baseDir: string;
  private readonly recordsDir: string;
  private readonly backupsDir: string;
  private readonly quarantineDir: string;
  private readonly markersDir: string;
  private readonly ready: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private lastAcceptedOperation = 0;
  private readonly failures = new Map<string, FailedWrite>();
  private readonly migrations = new Map<LegacyDesktopDomain, Promise<LegacyMigrationResult>>();
  private serializeCount = 0;
  private writeCount = 0;

  private readonly options: WorkerCoreOptions;
  constructor(options: WorkerCoreOptions) {
    this.options = options;
    this.baseDir = path.join(options.userDataPath, 'desktop-state-v2');
    this.recordsDir = path.join(this.baseDir, 'records');
    this.backupsDir = path.join(this.baseDir, 'backups');
    this.quarantineDir = path.join(this.baseDir, 'quarantine');
    this.markersDir = path.join(this.baseDir, 'migration-markers');
    this.ready = Promise.all([this.recordsDir, this.backupsDir, this.quarantineDir, this.markersDir]
      .map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 }))).then(() => undefined);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.ready).then(operation);
    // A failed write must not poison the queue for later recovery attempts.
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  getRecordHash(namespace: DesktopStateNamespace, key: string): string {
    return createHash('sha256').update(desktopStateRecordKey(namespace, key)).digest('hex');
  }
  private recordPath(namespace: DesktopStateNamespace, key: string): string {
    return path.join(this.recordsDir, `rec_${this.getRecordHash(namespace, key)}.json`);
  }
  private issuePath(namespace: DesktopStateNamespace, key: string): string {
    return path.join(this.quarantineDir, `issue_${this.getRecordHash(namespace, key)}.json`);
  }
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  private async readText(filePath: string): Promise<string | null> {
    try { return await fs.readFile(filePath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readRecord(namespace: DesktopStateNamespace, key: string): Promise<StoredRecord> {
    const issueRaw = await this.readText(this.issuePath(namespace, key));
    if (issueRaw) {
      return { record: null, issue: { namespace, key, code: 'corrupt', message: 'Saved state requires recovery; its original bytes are preserved in quarantine.' } };
    }
    let filePath = this.recordPath(namespace, key);
    let raw = await this.readText(filePath);
    // Read valid records written by the incomplete v2 implementation. Canonical
    // records (including tombstones) always win, so old copies cannot resurrect.
    if (raw === null) {
      const oldHash = createHash('sha256').update(`${namespace}::${key}`).digest('hex');
      filePath = path.join(this.recordsDir, `rec_${oldHash}.json`);
      raw = await this.readText(filePath);
    }
    if (raw === null) return { record: null, issue: null };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isDesktopStateRecord(parsed) || parsed.namespace !== namespace || parsed.key !== key) throw new Error('Invalid saved record envelope.');
      validateDesktopStateData(parsed);
      return { record: parsed, issue: null };
    } catch (error) {
      const issue: PersistenceLoadIssue = { namespace, key, code: 'corrupt', message: this.errorMessage(error) };
      // Keep a durable issue marker: a second load must not reinterpret corruption as absence.
      const backupPath = path.join(this.quarantineDir, `corrupt_${this.getRecordHash(namespace, key)}_${randomUUID()}.json`);
      await fs.writeFile(backupPath, raw, { flag: 'wx', mode: 0o600 });
      await fs.writeFile(this.issuePath(namespace, key), JSON.stringify({ ...issue, backupPath }), { mode: 0o600 });
      return { record: null, issue };
    }
  }

  async load(namespace: DesktopStateNamespace, keys?: string[]): Promise<PersistenceLoadResult> {
    assertPersistenceLoad(namespace, keys, false);
    return this.enqueue(async () => {
      const records: DesktopStateRecord[] = [];
      const issues: PersistenceLoadIssue[] = [];
      let selectedKeys = keys;
      if (selectedKeys === undefined) {
        const discovered = new Set<string>();
        for (const file of await fs.readdir(this.recordsDir)) {
          if (!/^rec_[a-f0-9]{64}\.json$/.test(file)) continue;
          const raw = await this.readText(path.join(this.recordsDir, file));
          if (!raw) continue;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (isDesktopStateRecord(parsed) && parsed.namespace === namespace) discovered.add(parsed.key);
          } catch {
            // A keyed load diagnoses a corrupt record precisely. An unkeyed scan
            // must disclose unreadable files rather than report a complete empty namespace.
            issues.push({ namespace, key: null, code: 'corrupt', message: `Unreadable saved record ${file}; no state was discarded.` });
          }
        }
        selectedKeys = [...discovered];
      }
      for (const key of selectedKeys) {
        try {
          const stored = await this.readRecord(namespace, key);
          if (stored.issue) issues.push(stored.issue);
          else if (stored.record) records.push(stored.record);
        } catch (error) {
          issues.push({ namespace, key, code: 'unreadable', message: this.errorMessage(error) });
        }
      }
      return { records, issues };
    });
  }

  private async replace(record: DesktopStateRecord): Promise<void> {
    const target = this.recordPath(record.namespace, record.key);
    const temp = `${target}.${randomUUID()}.tmp`;
    this.serializeCount++;
    const serialized = JSON.stringify(record);
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.options.beforeReplace?.(record);
      // Never unlink the committed target as a rename fallback.
      await fs.rename(temp, target);
      this.writeCount++;
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  commit(input: DesktopStateRecord[]): Promise<PersistenceCommitResult> {
    assertPersistenceBatch(input, false);
    // This clone occurs in the worker in production, not on navigation's main thread.
    const records = structuredClone(input);
    const watermark = ++this.lastAcceptedOperation;
    return this.enqueue(async () => {
      const acknowledgements: PersistenceAcknowledgement[] = [];
      const committedRevisions: Record<string, number> = {};
      let status: PersistenceCommitResult['status'] = 'committed';
      let errorMessage: string | undefined;
      for (const proposed of records) {
        const key = desktopStateRecordKey(proposed.namespace, proposed.key);
        try {
          validateDesktopStateData(proposed);
          const stored = await this.readRecord(proposed.namespace, proposed.key);
          if (stored.issue) throw new Error(stored.issue.message);
          const existing = stored.record;
          const currentRevision = existing?.recordRevision ?? 0;
          const dataText = JSON.stringify(proposed.data);
          const samePayload = existing && existing.deleted === proposed.deleted &&
            existing.bindingRevision === proposed.bindingRevision && JSON.stringify(existing.data) === dataText;
          if (existing && proposed.recordRevision === currentRevision && samePayload &&
              existing.mutationId === proposed.mutationId) {
            acknowledgements.push({ namespace: proposed.namespace, key: proposed.key, recordRevision: currentRevision,
              mutationId: proposed.mutationId, disposition: 'unchanged' });
            committedRevisions[key] = currentRevision;
            const failure = this.failures.get(key);
            if (failure && failure.revision <= currentRevision) this.failures.delete(key);
            continue;
          }
          if (proposed.recordRevision !== currentRevision + 1) {
            status = 'conflict';
            throw new Error(`Saved state version conflict for ${proposed.namespace}; reload this record before retrying.`);
          }
          let record = proposed;
          let disposition: PersistenceAcknowledgement['disposition'] = 'committed';
          if (record.namespace === 'queryCache' && Buffer.byteLength(dataText, 'utf8') > MAX_QUERY_PERSISTED_BYTES) {
            // An oversized fresh result stays in renderer memory, and invalidates any
            // older disk copy rather than silently resurrecting that copy next launch.
            record = { ...record, data: null, deleted: true };
            disposition = 'not-persisted';
          }
          await this.replace(record);
          acknowledgements.push({ namespace: record.namespace, key: record.key, recordRevision: record.recordRevision,
            mutationId: record.mutationId, disposition });
          committedRevisions[key] = record.recordRevision;
          this.failures.delete(key);
        } catch (error) {
          if (status !== 'conflict') status = 'error';
          errorMessage ??= this.errorMessage(error);
          this.failures.set(key, { watermark, revision: proposed.recordRevision, message: this.errorMessage(error) });
        }
      }
      if (records.some((record) => record.namespace === 'queryCache')) {
        try { await this.pruneQueryCache(); }
        catch (error) { status = 'error'; errorMessage ??= this.errorMessage(error); }
      }
      return { status, acknowledgements, committedRevisions, operationWatermark: watermark, errorMessage };
    });
  }

  private async pruneQueryCache(): Promise<void> {
    const entries: Array<{ filePath: string; bytes: number; updatedAt: number; record: DesktopStateRecord }> = [];
    for (const file of await fs.readdir(this.recordsDir)) {
      if (!/^rec_[a-f0-9]{64}\.json$/.test(file)) continue;
      const filePath = path.join(this.recordsDir, file);
      try {
        const raw = await this.readText(filePath);
        if (!raw) continue;
        const record: unknown = JSON.parse(raw);
        if (isDesktopStateRecord(record) && record.namespace === 'queryCache' && !record.deleted) {
          if (filePath === this.recordPath(record.namespace, record.key)) {
            entries.push({ filePath, bytes: Buffer.byteLength(raw, 'utf8'), updatedAt: record.updatedAt, record });
          }
        }
      } catch { /* A read diagnoses and preserves a corrupt record; pruning is not recovery. */ }
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt || a.filePath.localeCompare(b.filePath));
    let bytes = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      bytes += entry.bytes;
      if (index >= MAX_PERSISTED_QUERY_ENTRIES || bytes > QUERY_CACHE_PERSISTED_BUDGET) {
        // Keep the acknowledged version so a live renderer's next update does not
        // conflict after cache eviction. This policy tombstone is not a user edit.
        await this.replace({ ...entry.record, data: null, deleted: true });
      }
    }
  }

  flush(targetRevision = this.lastAcceptedOperation): Promise<PersistenceFlushResult> {
    const accepted = this.lastAcceptedOperation;
    if (!Number.isSafeInteger(targetRevision) || targetRevision < 0 || targetRevision > accepted) {
      return Promise.resolve({ status: 'error', flushedRevision: 0, errorMessage: 'Unknown persistence operation watermark.' });
    }
    return this.enqueue(async () => {
      const failed = [...this.failures.values()].find((failure) => failure.watermark <= targetRevision);
      return failed
        ? { status: 'error', flushedRevision: 0, errorMessage: failed.message }
        : { status: 'flushed', flushedRevision: targetRevision };
    });
  }

  migrateLegacyDomain(domain: LegacyDesktopDomain, rawPayload: string): Promise<LegacyMigrationResult> {
    assertLegacyMigration(domain, rawPayload, false);
    const pending = this.migrations.get(domain);
    if (pending) return pending.then(() => this.migrateLegacyDomain(domain, rawPayload));
    const task = this.importLegacy(domain, rawPayload);
    this.migrations.set(domain, task);
    void task.finally(() => { if (this.migrations.get(domain) === task) this.migrations.delete(domain); }).catch(() => undefined);
    return task;
  }

  private async importLegacy(domain: LegacyDesktopDomain, rawPayload: string): Promise<LegacyMigrationResult> {
    await this.ready;
    const domainHash = createHash('sha256').update(domain).digest('hex');
    const sourceChecksum = createHash('sha256').update(rawPayload).digest('hex');
    const markerPath = path.join(this.markersDir, `${domainHash}.json`);
    const existingMarker = await this.readText(markerPath);
    if (existingMarker) {
      try {
        const marker = JSON.parse(existingMarker) as LegacyMigrationResult & { migrationVersion?: number };
        if (marker.migrationVersion === 2 && marker.sourceChecksum === sourceChecksum && marker.domain === domain) return marker;
      } catch { /* Preserve raw source and rebuild the marker only after validating imports. */ }
    }
    const backupPath = path.join(this.backupsDir, `${domainHash}_${sourceChecksum}.json`);
    await fs.writeFile(backupPath, rawPayload, { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    // A malformed envelope is a failed migration, never an empty successful import.
    const decoded = decodeLegacyDesktopState(domain, rawPayload);
    let importedCount = 0;
    let skippedCount = decoded.skippedCount;
    for (const record of decoded.records) {
      const existing = await this.load(record.namespace, [record.key]);
      if (existing.issues.length > 0) throw new Error('Saved state requires explicit recovery before importing this scope.');
      if (existing.records.length > 0) { skippedCount++; continue; }
      const result = await this.commit([{ ...record, updatedAt: Date.now(), mutationId: `migration:${sourceChecksum}:${this.getRecordHash(record.namespace, record.key)}` }]);
      if (result.status !== 'committed') throw new Error(result.errorMessage ?? 'Legacy import was not committed.');
      importedCount++;
    }
    const flush = await this.flush();
    if (flush.status !== 'flushed') throw new Error(flush.errorMessage ?? 'Legacy import flush failed.');
    const result: LegacyMigrationResult = { domain, importedCount, quarantinedCount: decoded.quarantinedCount,
      skippedCount, backupPath, sourceChecksum };
    // Quarantined user-state records require recovery; never mark their domain complete.
    if (decoded.quarantinedCount > 0) throw new Error(`Legacy ${domain} has ${decoded.quarantinedCount} invalid records; valid neighbors were imported and the raw backup is preserved at ${backupPath}.`);
    const temporaryMarker = `${markerPath}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryMarker, JSON.stringify({ ...result, migrationVersion: 2 }), { mode: 0o600 });
    await fs.rename(temporaryMarker, markerPath);
    return result;
  }

  async importMainRegistry(): Promise<LegacyMigrationResult | null> {
    const raw = await this.readText(path.join(this.options.userDataPath, 'workbench-session-registry.json'));
    return raw === null ? null : this.migrateLegacyDomain('workbench-session-registry.json', raw);
  }

  diagnostics(): { isMainThread: boolean; threadId: number; serializeCount: number; writeCount: number } {
    return { isMainThread, threadId, serializeCount: this.serializeCount, writeCount: this.writeCount };
  }
}
