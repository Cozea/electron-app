/**
 * Desktop State Persistence Worker Core
 * Conforms to Section 10 of docs/perf/navigation-runtime-plan.md
 *
 * Implements:
 * - Atomic file replacement (write to tmp -> fs.promises.rename) (Section 10.6, M12)
 * - Serial per-key write queues preventing out-of-order overwrite (Section 10.6, M11)
 * - Envelope validation and SHA-256 hash-addressed record paths (Section 10.2)
 * - Bounded query cache entries (1 MiB cap) (Section 10.3, M20)
 * - Legacy data backup, quarantine of corrupt records, and migration markers (Section 10.9, M13, M14)
 * - Flush-through-revision lifecycle guarantees (Section 10.6, M18)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  DesktopStateNamespace,
  DesktopStateRecord,
  PersistenceCommitResult,
  PersistenceLoadResult,
  PersistenceFlushResult,
  LegacyMigrationResult,
} from '@shared/desktopPersistenceTypes';

const MAX_QUERY_CACHE_ENTRY_BYTES = 1024 * 1024; // 1 MiB cap (Section 10.3, M20)

export interface WorkerCoreOptions {
  userDataPath: string;
}

export class DesktopStatePersistenceWorkerCore {
  private readonly baseDir: string;
  private readonly recordsDir: string;
  private readonly tmpDir: string;
  private readonly backupsDir: string;
  private readonly quarantineDir: string;
  private readonly markersDir: string;

  // Serial queue per key hash
  private keyQueues = new Map<string, Promise<void>>();
  private highestCommittedRevision = 0;
  private inFlightWrites = new Set<Promise<void>>();

  constructor(options: WorkerCoreOptions) {
    this.baseDir = path.join(options.userDataPath, 'desktop-state-v2');
    this.recordsDir = path.join(this.baseDir, 'records');
    this.tmpDir = path.join(this.baseDir, 'tmp');
    this.backupsDir = path.join(this.baseDir, 'backups');
    this.quarantineDir = path.join(this.baseDir, 'quarantine');
    this.markersDir = path.join(this.baseDir, 'migration-markers');

    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(this.recordsDir, { recursive: true });
    fs.mkdirSync(this.tmpDir, { recursive: true });
    fs.mkdirSync(this.backupsDir, { recursive: true });
    fs.mkdirSync(this.quarantineDir, { recursive: true });
    fs.mkdirSync(this.markersDir, { recursive: true });
  }

  getRecordHash(namespace: DesktopStateNamespace, key: string): string {
    return crypto.createHash('sha256').update(`${namespace}::${key}`).digest('hex');
  }

  private getRecordPath(hash: string): string {
    return path.join(this.recordsDir, `rec_${hash}.json`);
  }

  async load(namespace: DesktopStateNamespace, keys?: string[]): Promise<PersistenceLoadResult> {
    const results: DesktopStateRecord[] = [];

    if (keys && keys.length > 0) {
      for (const key of keys) {
        const hash = this.getRecordHash(namespace, key);
        const record = await this.readRecordFile(hash, namespace, key);
        if (record) {
          results.push(record);
        }
      }
    } else {
      // Load all records matching namespace
      const files = await fs.promises.readdir(this.recordsDir);
      for (const file of files) {
        if (!file.startsWith('rec_') || !file.endsWith('.json')) continue;
        const filePath = path.join(this.recordsDir, file);
        try {
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const parsed = JSON.parse(raw) as DesktopStateRecord;
          if (parsed && parsed.schemaVersion === 1 && parsed.namespace === namespace) {
            results.push(parsed);
          }
        } catch {
          // Quarantine corrupt record
          await this.quarantineFile(filePath, file);
        }
      }
    }

    return { records: results };
  }

  private async readRecordFile(
    hash: string,
    expectedNamespace: DesktopStateNamespace,
    expectedKey: string
  ): Promise<DesktopStateRecord | null> {
    const filePath = this.getRecordPath(hash);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as DesktopStateRecord;
      if (
        parsed &&
        parsed.schemaVersion === 1 &&
        parsed.namespace === expectedNamespace &&
        parsed.key === expectedKey
      ) {
        return parsed;
      }
      return null;
    } catch {
      await this.quarantineFile(filePath, `rec_${hash}.json`);
      return null;
    }
  }

  private async quarantineFile(filePath: string, fileName: string): Promise<void> {
    try {
      const dest = path.join(this.quarantineDir, `${Date.now()}_${fileName}`);
      await fs.promises.rename(filePath, dest);
    } catch (err) {
      console.warn('[PersistenceWorker] Failed to quarantine corrupt file:', err);
    }
  }

  async commit(records: DesktopStateRecord[]): Promise<PersistenceCommitResult> {
    const committedRevisions: Record<string, number> = {};

    for (const record of records) {
      // Enforce namespace input limit (M20)
      if (record.namespace === 'queryCache') {
        const serialized = JSON.stringify(record.data);
        if (Buffer.byteLength(serialized, 'utf8') > MAX_QUERY_CACHE_ENTRY_BYTES) {
          return {
            status: 'error',
            committedRevisions,
            errorMessage: `Query cache entry exceeds 1 MiB limit for key: ${record.key}`,
          };
        }
      }

      const hash = this.getRecordHash(record.namespace, record.key);
      const queueKey = `${record.namespace}:${hash}`;

      const previousTask = this.keyQueues.get(queueKey) ?? Promise.resolve();
      const currentTask = previousTask.then(async () => {
        await this.writeRecordWithAtomicReplacement(hash, record);
        committedRevisions[record.key] = record.recordRevision;
        if (record.recordRevision > this.highestCommittedRevision) {
          this.highestCommittedRevision = record.recordRevision;
        }
      });

      this.keyQueues.set(queueKey, currentTask);
      this.inFlightWrites.add(currentTask);
      currentTask.finally(() => {
        this.inFlightWrites.delete(currentTask);
      });

      try {
        await currentTask;
      } catch (err) {
        return {
          status: 'error',
          committedRevisions,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return {
      status: 'committed',
      committedRevisions,
    };
  }

  private async writeRecordWithAtomicReplacement(
    hash: string,
    newRecord: DesktopStateRecord
  ): Promise<void> {
    const targetPath = this.getRecordPath(hash);

    // Enforce monotonic revision ordering (M11)
    if (fs.existsSync(targetPath)) {
      try {
        const rawExisting = await fs.promises.readFile(targetPath, 'utf8');
        const existing = JSON.parse(rawExisting) as DesktopStateRecord;
        if (existing.recordRevision >= newRecord.recordRevision) {
          // Newer or equal revision already committed; do not overwrite (M11)
          return;
        }
      } catch {
        // If existing is corrupt, we will overwrite it with the new valid record
      }
    }

    // Write to temporary file in the same directory (or tmpDir on same filesystem)
    const tmpFileName = `tmp_${hash}_${Date.now()}_${Math.random().toString(36).slice(2)}.tmp`;
    const tmpFilePath = path.join(this.tmpDir, tmpFileName);

    const serialized = JSON.stringify(newRecord, null, 2);
    await fs.promises.writeFile(tmpFilePath, serialized, 'utf8');

    // Atomic replacement (fs.promises.rename) (M12)
    try {
      await fs.promises.rename(tmpFilePath, targetPath);
    } catch (renameErr) {
      // Clean up tmp file on failure, leaving target intact
      try {
        await fs.promises.unlink(tmpFilePath);
      } catch {}
      throw renameErr;
    }
  }

  async flush(targetRevision?: number): Promise<PersistenceFlushResult> {
    try {
      while (this.inFlightWrites.size > 0) {
        await Promise.all(Array.from(this.inFlightWrites));
      }

      if (targetRevision !== undefined && this.highestCommittedRevision < targetRevision) {
        return {
          status: 'error',
          flushedRevision: this.highestCommittedRevision,
          errorMessage: `Flushed up to revision ${this.highestCommittedRevision}, requested ${targetRevision}`,
        };
      }

      return {
        status: 'flushed',
        flushedRevision: this.highestCommittedRevision,
      };
    } catch (err) {
      return {
        status: 'error',
        flushedRevision: this.highestCommittedRevision,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async migrateLegacyDomain(
    domain: string,
    rawPayload: string
  ): Promise<LegacyMigrationResult> {
    const markerPath = path.join(this.markersDir, `${domain}.json`);

    // Check if migration marker already exists (M13 - idempotent restart)
    if (fs.existsSync(markerPath)) {
      const markerContent = await fs.promises.readFile(markerPath, 'utf8');
      const parsed = JSON.parse(markerContent);
      return {
        domain,
        importedCount: parsed.importedCount ?? 0,
        quarantinedCount: parsed.quarantinedCount ?? 0,
        backupPath: parsed.backupPath ?? '',
      };
    }

    // 1. Create preserved backup first (Section 10.9)
    const backupPath = path.join(this.backupsDir, `${domain}_${Date.now()}.json`);
    await fs.promises.writeFile(backupPath, rawPayload, 'utf8');

    let importedCount = 0;
    let quarantinedCount = 0;

    try {
      const parsed = JSON.parse(rawPayload);

      if (domain === 'cozea:project-workbench-layouts' && typeof parsed === 'object' && parsed !== null) {
        for (const [key, val] of Object.entries(parsed)) {
          if (val && typeof val === 'object') {
            await this.commit([
              {
                schemaVersion: 1,
                namespace: 'workbenchLayout',
                key,
                recordRevision: 1,
                updatedAt: Date.now(),
                data: val,
              },
            ]);
            importedCount++;
          } else {
            quarantinedCount++;
          }
        }
      } else if (domain === 'cozea:project-workbench' && typeof parsed === 'object' && parsed !== null) {
        for (const [key, val] of Object.entries(parsed)) {
          if (val && typeof val === 'object') {
            await this.commit([
              {
                schemaVersion: 1,
                namespace: 'workbenchModel',
                key,
                recordRevision: 1,
                updatedAt: Date.now(),
                data: val,
              },
            ]);
            importedCount++;
          } else {
            quarantinedCount++;
          }
        }
      } else if (domain === 'cozea-query-cache' && typeof parsed === 'object' && parsed !== null) {
        for (const [key, val] of Object.entries(parsed)) {
          if (val) {
            await this.commit([
              {
                schemaVersion: 1,
                namespace: 'queryCache',
                key,
                recordRevision: 1,
                updatedAt: Date.now(),
                data: val,
              },
            ]);
            importedCount++;
          }
        }
      }
    } catch {
      quarantinedCount++;
    }

    // Write migration complete marker LAST (Section 10.9)
    await fs.promises.writeFile(
      markerPath,
      JSON.stringify({ domain, importedCount, quarantinedCount, backupPath, completedAt: Date.now() }, null, 2),
      'utf8'
    );

    return {
      domain,
      importedCount,
      quarantinedCount,
      backupPath,
    };
  }
}
