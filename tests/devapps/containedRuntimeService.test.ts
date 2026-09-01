import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeviceContainedDevAppRuntimeService,
  type ContainedRuntimeHelperProcess,
} from "../../apps/desktop/electron/services/ContainedDevAppRuntimeService";
import {
  DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
  type DevAppContainedRuntimeStartRequest,
} from "../../shared/devAppContainedRuntime";

const digest = `sha256:${"a".repeat(64)}`;
const platformDigest = `sha256:${"b".repeat(64)}`;
const attestationDigest = `sha256:${"c".repeat(64)}`;
const temporaryRoots: string[] = [];

class FakeHelper extends EventEmitter implements ContainedRuntimeHelperProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killedWith: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    this.exitCode = 0;
    return true;
  }
}

function fixturePaths(): {
  helperPath: string;
  rootPath: string;
  kernelPath: string;
  resourceManifestPath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-contained-runtime-"));
  temporaryRoots.push(root);
  const helperPath = path.join(root, "helper");
  const kernelPath = path.join(root, "kernel");
  fs.writeFileSync(helperPath, "helper");
  fs.writeFileSync(kernelPath, "kernel");
  const resourceManifestPath = path.join(root, "resources.json");
  const sha256 = (value: string) =>
    `sha256:${createHash("sha256").update(value).digest("hex")}`;
  fs.writeFileSync(
    resourceManifestPath,
    JSON.stringify({
      version: 1,
      containerizationVersion: "0.43.0",
      helperSha256: sha256("helper"),
      kernelSha256: sha256("kernel"),
      initfsReference: `registry.example/cozea/initfs@${digest}`,
    }),
  );
  return {
    helperPath,
    rootPath: path.join(root, "state"),
    kernelPath,
    resourceManifestPath,
  };
}

function startRequest(): DevAppContainedRuntimeStartRequest {
  return {
    runtimeId: "devapp-a1",
    identity: {
      organizationId: "org-a",
      publicationId: "publication-a",
      releaseId: "release-a",
      releaseVersion: 1,
      contentHash: "d".repeat(64),
      sourceDigest: "d".repeat(64),
      packageManifestDigest: `sha256:${"f".repeat(64)}`,
    },
    location: "device",
    state: "device",
    image: {
      reference: `registry.example/cozea/devapp@${digest}`,
      manifestDigest: digest,
      platformDigest,
      platform: "linux/arm64",
      signature: "signed-envelope",
      attestationDigest,
      attestation: {
        version: 1,
        builderId: "cozea-devapp-builder/v1",
        sourceDigest: "d".repeat(64),
        packageManifestDigest: `sha256:${"f".repeat(64)}`,
        manifestDigest: digest,
        platforms: [
          { platform: "linux/arm64", digest: platformDigest },
          { platform: "linux/amd64", digest: `sha256:${"e".repeat(64)}` },
        ],
        materials: [],
        builtAt: 1,
        reproducible: true,
      },
    },
    command: ["/app/server"],
    environment: { NODE_ENV: "production" },
    workingDirectory: "/app",
    servicePort: 3000,
    network: true,
    resources: {
      cpus: 1,
      memoryBytes: 512 * 1024 * 1024,
      rootfsBytes: 1024 * 1024 * 1024,
      writableLayerBytes: 256 * 1024 * 1024,
    },
    folderGrants: [],
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("DeviceContainedDevAppRuntimeService", () => {
  it("verifies immutable image authority before forwarding a start to the helper", async () => {
    const helper = new FakeHelper();
    const verify = vi.fn(async () => undefined);
    const service = new DeviceContainedDevAppRuntimeService({
      paths: fixturePaths,
      imageVerifier: { verify },
      spawnHelper: () => helper,
    });
    helper.stdin.on("data", (data: Buffer) => {
      const request = JSON.parse(data.toString()) as {
        requestId: string;
        start: DevAppContainedRuntimeStartRequest;
      };
      helper.stdout.write(
        `${JSON.stringify({
          protocolVersion: DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION,
          requestId: request.requestId,
          success: true,
          state: {
            runtimeId: request.start.runtimeId,
            status: "running",
            location: "device",
            state: "device",
            publicationId: "publication-a",
            releaseId: "release-a",
            imageDigest: digest,
            guestAddress: "192.168.64.2",
            servicePort: 3000,
            startedAt: 1,
            exitedAt: null,
            exitCode: null,
            error: null,
          },
        })}\n`,
      );
    });

    await expect(service.start(startRequest())).resolves.toMatchObject({
      runtimeId: "devapp-a1",
      status: "running",
      guestAddress: "192.168.64.2",
    });
    expect(verify).toHaveBeenCalledOnce();
    service.dispose();
  });

  it("fails closed before spawning when image verification fails", async () => {
    const spawnHelper = vi.fn(() => new FakeHelper());
    const service = new DeviceContainedDevAppRuntimeService({
      paths: fixturePaths,
      imageVerifier: {
        verify: async () => {
          throw new Error("signature rejected");
        },
      },
      spawnHelper,
    });

    await expect(service.start(startRequest())).rejects.toThrow("signature rejected");
    expect(spawnHelper).not.toHaveBeenCalled();
  });

  it("kills the helper and rejects pending work after a malformed protocol message", async () => {
    const helper = new FakeHelper();
    const service = new DeviceContainedDevAppRuntimeService({
      paths: fixturePaths,
      imageVerifier: { verify: async () => undefined },
      spawnHelper: () => helper,
    });
    helper.stdin.on("data", () => helper.stdout.write("not-json\n"));

    await expect(service.inspect("devapp-a1")).rejects.toThrow("malformed JSON");
    expect(helper.killedWith).toBe("SIGKILL");
  });

  it("rejects an expired or cross-release folder grant before verification", async () => {
    const verify = vi.fn(async () => undefined);
    const request = startRequest();
    request.folderGrants = [
      {
        grantId: "grant-a",
        publicationId: "another-publication",
        releaseId: request.identity.releaseId,
        canonicalHostPath: "/private/tmp",
        guestPath: "/cozea/grants/grant-a",
        access: "read",
        expiresAt: Date.now() + 10_000,
      },
    ];
    const service = new DeviceContainedDevAppRuntimeService({
      paths: fixturePaths,
      imageVerifier: { verify },
      spawnHelper: () => new FakeHelper(),
    });

    await expect(service.start(request)).rejects.toThrow("expired or belongs to another release");
    expect(verify).not.toHaveBeenCalled();
  });
});
