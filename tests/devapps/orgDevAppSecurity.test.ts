import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";
import { partitionForDescriptor } from "@shared/browserSurfaceSessions";

const root = process.cwd();
const devApps = fs.readFileSync(path.join(root, "convex/devApps.ts"), "utf8");
const artifacts = fs.readFileSync(
  path.join(root, "apps/desktop/electron/services/OrgDevAppArtifactService.ts"),
  "utf8",
);
const publishing = fs.readFileSync(
  path.join(root, "apps/desktop/src/features/devapps/orgDevAppPublishing.ts"),
  "utf8",
);
const upload = fs.readFileSync(
  path.join(root, "apps/desktop/electron/services/orgDevAppUpload.ts"),
  "utf8",
);
const main = fs.readFileSync(path.join(root, "apps/desktop/electron/main.ts"), "utf8");
const browserSurfaceService = fs.readFileSync(
  path.join(root, "apps/desktop/electron/services/T3BrowserSurfaceService.ts"),
  "utf8",
);

describe("org DevApp security lifecycle", () => {
  it("binds uploads to an authenticated reservation and verifies storage metadata", () => {
    expect(devApps).toContain("createUploadReservation");
    expect(devApps).toContain("registerUploadedArtifact");
    expect(devApps).toContain('ctx.db.system.get("_storage", args.storageId)');
    expect(devApps).toContain("normalizeStorageSha256(metadata.sha256) !== contentHash");
    expect(devApps).toContain("reservation.createdBy !== user._id");
    expect(devApps).not.toContain("export const generateUploadUrl");
    expect(publishing).toContain("orgDevApp.buildAndUpload");
    expect(publishing).not.toContain("body: zipBytes");
    expect(upload).toContain("hashBuffer(zip) !== packed.contentHash.toLowerCase()");
    expect(upload).toContain('.endsWith(".convex.cloud")');
  });

  it("bounds release retention and denies cached reopening after access loss", () => {
    expect(devApps).toContain("DEVAPP_RELEASE_RETENTION");
    expect(devApps).toContain("retainedReleases.slice(DEVAPP_RELEASE_RETENTION)");
    expect(devApps).toContain("if (!(await isOrgMember");
    expect(devApps).toContain("return null");
  });

  it("connects hardened custom-protocol handling only to prepared T3 publication sessions", () => {
    expect(artifacts).toContain(
      "registerProtocolForSession(targetSession: Session, partitionKey: string)",
    );
    expect(artifacts).toContain("DEVAPP_GATEWAY_TOKEN_HEADER");
    expect(artifacts).toContain("gatewayPublications");
    expect(main).toContain("orgDevAppArtifactService.registerProtocol()");
    expect(main).not.toContain("orgDevAppArtifactService.registerProtocolForSession(");
    expect(browserSurfaceService).toContain(
      "this.options.orgDevAppArtifactService.registerProtocolForSession(",
    );
    expect(browserSurfaceService).toContain("partitionForDescriptor(descriptor)");
    // The partition rule itself now lives in shared/browserSurfaceSessions and is
    // exercised directly, rather than asserted here as a template literal that any
    // refactor breaks without telling anyone whether the property still holds.
    expect(
      partitionForDescriptor({
        runtimeTabId: "tab_1",
        tileId: "tile_1",
        workbenchSessionKey: "session_1",
        kind: "orgDevApp",
        title: "T",
        initialUrl: null,
        storageScope: "orgDevApp",
        publicationId: "pub_1",
      }),
    ).toBe("persist:cozea-devapp-pub_1");
  });

  it("confines navigation and never externalizes custom or authenticated loopback URLs", () => {
    expect(browserSurfaceService).toContain("evaluateOrgDevAppNavigation");
    expect(browserSurfaceService).toContain("getOrgDevAppNavigationScope");
    expect(browserSurfaceService).toContain('.reason === "external-https"');
    expect(browserSurfaceService).toContain('if (descriptor.kind !== "orgDevApp")');
    expect(browserSurfaceService).toContain("this.pendingDirectNavigationByTabId.set(tabId, url)");
    expect(browserSurfaceService).toContain("await guest.loadURL(url)");
    expect(browserSurfaceService).not.toContain("isSafeExternalUrl");
    expect(browserSurfaceService).toContain('browserSession.on("will-download"');
    expect(browserSurfaceService).toContain("ALLOWED_PREVIEW_PERMISSIONS");
  });

  it("uses a bounded, integrity-checked, evictable local cache", () => {
    expect(artifacts).toContain("maxCompressedBytes");
    expect(artifacts).toContain("hashBuffer(zip) !== contentHash");
    expect(artifacts).toContain("DEVAPP_CACHE_MAX_BYTES");
    expect(artifacts).toContain("DEVAPP_CACHE_MAX_RELEASES");
    expect(artifacts).toContain("DEVAPP_CACHE_MAX_AGE_MS");
    expect(artifacts).toContain("content-security-policy");
  });

  it.each([
    "security.permissions-downloads",
    "security.external-navigation",
    "security.org-devapp-protocol",
  ])("records executable Cozea/T3 coverage for %s", (id) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "security",
      status: "cozea-adapted",
    });
  });
});
