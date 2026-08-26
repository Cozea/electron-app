/**
 * Phase 6 / Track E — small NDJSON span writer for substrate spine events.
 *
 * Gated by `cozea.obs.ndjson` (`COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON`).
 * Default off; failures never throw into product paths.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSubstrateObsNdjsonFlags } from "../flags";

export interface SubstrateNdjsonSpan {
  readonly name: string;
  readonly ts?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

export interface SubstrateNdjsonWriter {
  readonly enabled: boolean;
  readonly filePath: string | null;
  writeSpan(span: SubstrateNdjsonSpan): void;
  flush(): void;
  dispose(): void;
}

export interface CreateSubstrateNdjsonWriterOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override output path (tests). When unset, uses env or a temp default. */
  readonly filePath?: string | null;
  /**
   * When true, create a writer even if the env flag is off (tests).
   * Production callers must leave this unset.
   */
  readonly forceEnable?: boolean;
}

function resolveDefaultFilePath(env: NodeJS.ProcessEnv): string {
  const fromEnv =
    env.COZEA_OBS_NDJSON_PATH?.trim() ||
    env.COZEA_SUBSTRATE_OBS_NDJSON_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(os.tmpdir(), "cozea-substrate-obs.ndjson");
}

/**
 * Create a best-effort NDJSON span writer. When the flag is off, returns a
 * no-op writer (`enabled: false`) so call sites can always invoke `writeSpan`.
 */
export function createSubstrateNdjsonWriter(
  options: CreateSubstrateNdjsonWriterOptions = {},
): SubstrateNdjsonWriter {
  const env = options.env ?? process.env;
  const flags = readSubstrateObsNdjsonFlags(env);
  const enabled = options.forceEnable === true || flags.enabled;

  if (!enabled) {
    return {
      enabled: false,
      filePath: null,
      writeSpan() {
        // no-op
      },
      flush() {
        // no-op
      },
      dispose() {
        // no-op
      },
    };
  }

  const filePath =
    options.filePath === null
      ? null
      : (options.filePath?.trim() || resolveDefaultFilePath(env));

  let stream: fs.WriteStream | null = null;

  const ensureStream = (): fs.WriteStream | null => {
    if (!filePath) {
      return null;
    }
    if (stream) {
      return stream;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      stream = fs.createWriteStream(filePath, { flags: "a" });
      stream.on("error", () => {
        stream = null;
      });
      return stream;
    } catch {
      stream = null;
      return null;
    }
  };

  return {
    enabled: true,
    filePath,
    writeSpan(span) {
      const line = JSON.stringify({
        name: span.name,
        ts: span.ts ?? new Date().toISOString(),
        ...(span.attrs ? { attrs: span.attrs } : {}),
      });
      const target = ensureStream();
      if (!target) {
        return;
      }
      try {
        target.write(`${line}\n`);
      } catch {
        // best-effort
      }
    },
    flush() {
      // WriteStream has no sync flush; rely on process lifetime / dispose.
    },
    dispose() {
      if (stream) {
        try {
          stream.end();
        } catch {
          // ignore
        }
        stream = null;
      }
    },
  };
}

let sharedWriter: SubstrateNdjsonWriter | null = null;

/**
 * Process-wide shared writer (Electron main / shadow child).
 * Idempotent; respects the current env flag on first call.
 */
export function getSharedSubstrateNdjsonWriter(
  options: CreateSubstrateNdjsonWriterOptions = {},
): SubstrateNdjsonWriter {
  if (!sharedWriter) {
    sharedWriter = createSubstrateNdjsonWriter(options);
  }
  return sharedWriter;
}

/** @internal test helper */
export function resetSharedSubstrateNdjsonWriterForTests(): void {
  sharedWriter?.dispose();
  sharedWriter = null;
}
