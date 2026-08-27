import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopBackendPool } from "../../apps/desktop/electron/substrate/backend/DesktopBackendPool";
import { PRIMARY_BACKEND_INSTANCE_ID } from "../../apps/desktop/electron/substrate/backend/types";
import { discoverSshHostsFromConfig } from "../../apps/desktop/electron/substrate/ssh/parseSshConfig";

describe("DesktopBackendPool", () => {
  const tempDirs: string[] = [];
  const pools: DesktopBackendPool[] = [];

  afterEach(async () => {
    for (const pool of pools.splice(0)) {
      await pool.stopAll().catch(() => undefined);
    }
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers primary instance metadata", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-backend-pool-"));
    tempDirs.push(root);
    const entryPath = path.join(root, "missing-entry.js");

    const pool = new DesktopBackendPool({
      entryPath,
      logsRootDirectory: path.join(root, "logs"),
    });
    pools.push(pool);

    await expect(
      pool.register({
        id: PRIMARY_BACKEND_INSTANCE_ID,
        kind: "local",
        label: "Local",
        port: 4877,
        logDirectory: pool.resolvePrimaryLogDirectory(),
        t3BaseDir: pool.resolveInstanceT3BaseDir(PRIMARY_BACKEND_INSTANCE_ID),
      }),
    ).rejects.toThrow();

    expect(pool.listDescriptors()).toHaveLength(0);
  }, 5_000);

  it("refuses duplicate registration ids", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-backend-pool-dup-"));
    tempDirs.push(root);
    const pool = new DesktopBackendPool({
      entryPath: path.join(root, "entry.js"),
      logsRootDirectory: path.join(root, "logs"),
    });
    pools.push(pool);

    const spec = {
      id: PRIMARY_BACKEND_INSTANCE_ID,
      kind: "local" as const,
      label: "Local",
      port: 4888,
      logDirectory: pool.resolvePrimaryLogDirectory(),
      t3BaseDir: pool.resolveInstanceT3BaseDir(PRIMARY_BACKEND_INSTANCE_ID),
    };

    (pool as unknown as { instances: Map<string, unknown> }).instances.set(spec.id, {
      descriptor: spec,
      manager: {},
    });

    expect(pool.listDescriptors()).toHaveLength(1);
    expect(
      pool.register({
        ...spec,
        port: 4889,
      }),
    ).rejects.toThrow(/already registered/);
  });
});

describe("parseSshConfig", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers Host entries from ssh config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-ssh-config-"));
    tempDirs.push(root);
    const configPath = path.join(root, "config");
    fs.writeFileSync(
      configPath,
      `Host dev-box
  HostName example.com
  User alice
  Port 2222
`,
    );

    const hosts = discoverSshHostsFromConfig(configPath);
    expect(hosts).toEqual([
      {
        alias: "dev-box",
        hostname: "example.com",
        username: "alice",
        port: 2222,
        source: "ssh-config",
      },
    ]);
  });
});
