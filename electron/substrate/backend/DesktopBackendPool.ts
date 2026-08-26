import path from "node:path";
import fs from "node:fs";

import {
  getShadowServerManager,
  ShadowServerManager,
  type ShadowServerStatus,
} from "../ShadowServerManager";
import { readSubstrateShadowServerFlags } from "../flags";
import {
  PRIMARY_BACKEND_INSTANCE_ID,
  type BackendInstanceDescriptor,
  type RegisterBackendInstanceInput,
} from "./types";

interface RegisteredBackend {
  readonly descriptor: BackendInstanceDescriptor;
  readonly manager: ShadowServerManager;
}

export interface DesktopBackendPoolOptions {
  readonly entryPath: string;
  readonly logsRootDirectory: string;
}

/**
 * Manages one or more substrate shadow-server child processes (T3-shaped
 * DesktopBackendPool port for Cozea).
 */
export class DesktopBackendPool {
  private readonly entryPath: string;
  private readonly logsRootDirectory: string;
  private readonly instances = new Map<string, RegisteredBackend>();

  constructor(options: DesktopBackendPoolOptions) {
    this.entryPath = options.entryPath;
    this.logsRootDirectory = options.logsRootDirectory;
  }

  listDescriptors(): ReadonlyArray<BackendInstanceDescriptor> {
    return Array.from(this.instances.values()).map((entry) => entry.descriptor);
  }

  getManager(id: string): ShadowServerManager | null {
    return this.instances.get(id)?.manager ?? null;
  }

  getPrimaryManager(): ShadowServerManager | null {
    return this.getManager(PRIMARY_BACKEND_INSTANCE_ID);
  }

  async register(input: RegisterBackendInstanceInput): Promise<ShadowServerStatus> {
    if (this.instances.has(input.id)) {
      throw new Error(`Backend instance "${input.id}" is already registered.`);
    }

    const host = input.host ?? readSubstrateShadowServerFlags().host;
    const manager = new ShadowServerManager({
      entryPath: this.entryPath,
      logDirectory: input.logDirectory,
      flags: {
        flagId: readSubstrateShadowServerFlags().flagId,
        enabled: true,
        host,
        port: input.port,
      },
      instanceId: input.id,
      t3BaseDir: input.t3BaseDir,
    });

    const descriptor: BackendInstanceDescriptor = {
      id: input.id,
      kind: input.kind,
      label: input.label,
      host,
      port: input.port,
      logDirectory: input.logDirectory,
      t3BaseDir: input.t3BaseDir,
      wslDistro: input.wslDistro ?? null,
    };

    try {
      fs.mkdirSync(input.logDirectory, { recursive: true });
      const status = await manager.start();
      this.instances.set(input.id, { descriptor, manager });
      return status;
    } catch (error) {
      await manager.stop().catch(() => undefined);
      throw error;
    }
  }

  async unregister(id: string): Promise<void> {
    if (id === PRIMARY_BACKEND_INSTANCE_ID) {
      throw new Error("Refusing to unregister the primary backend instance.");
    }
    const entry = this.instances.get(id);
    if (!entry) {
      return;
    }
    await entry.manager.stop();
    this.instances.delete(id);
  }

  async stopAll(): Promise<void> {
    for (const entry of this.instances.values()) {
      await entry.manager.stop();
    }
    this.instances.clear();
  }

  resolvePrimaryLogDirectory(): string {
    return path.join(this.logsRootDirectory, PRIMARY_BACKEND_INSTANCE_ID);
  }

  resolveInstanceLogDirectory(instanceId: string): string {
    return path.join(this.logsRootDirectory, instanceId.replace(/[^a-zA-Z0-9._-]+/g, "_"));
  }

  resolveInstanceT3BaseDir(instanceId: string): string {
    return path.join(this.logsRootDirectory, "..", "t3-server", instanceId.replace(/:/g, "-"));
  }
}

let poolSingleton: DesktopBackendPool | null = null;

export function getDesktopBackendPool(): DesktopBackendPool | null {
  return poolSingleton;
}

export function createDesktopBackendPool(options: DesktopBackendPoolOptions): DesktopBackendPool {
  poolSingleton = new DesktopBackendPool(options);
  return poolSingleton;
}

/** Back-compat: primary shadow manager from pool or legacy singleton. */
export function getPrimaryShadowServerManager(): ShadowServerManager | null {
  return poolSingleton?.getPrimaryManager() ?? getShadowServerManager();
}
