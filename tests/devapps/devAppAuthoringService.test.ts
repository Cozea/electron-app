import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevAppAuthoringService } from "../../apps/desktop/electron/services/DevAppAuthoringService";
import { DEV_APP_PACKAGE_JSON_SCHEMA } from "../../shared/devAppPackage";

const roots: string[] = [];

function temporaryWorkspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cozea-devapp-authoring-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("DevAppAuthoringService", () => {
  it("creates a valid view/worker project with generated authoring assets", () => {
    const root = temporaryWorkspace();
    const service = new DevAppAuthoringService();
    const result = service.scaffold({
      projectId: "project_a",
      workspaceId: "workspace_a",
      workspaceRoot: root,
      name: "Issue Explorer",
      starter: "view-worker",
    });

    expect(result.source.name).toBe("Issue Explorer");
    expect(result.source.ref).toMatch(/^cozea-devapp:dev\/[a-f0-9]{32}$/);
    expect(result.source).not.toHaveProperty("path");
    expect(result.createdFiles).toContain("dist/index.html");
    expect(result.createdFiles).toContain("worker/index.js");
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))).toMatchObject({
      dependencies: { "@cozea/devapp-api": "^0.1.0" },
    });
    expect(
      JSON.parse(readFileSync(path.join(root, ".cozea/cozea-devapp.schema.json"), "utf8")),
    ).toEqual(DEV_APP_PACKAGE_JSON_SCHEMA);

    const inspection = service.inspect({
      projectId: "project_a",
      workspaceId: "workspace_a",
      workspaceRoot: root,
    });
    expect(inspection.status).toBe("valid");
  });

  it("never overwrites an existing package and reports invalid imports", () => {
    const root = temporaryWorkspace();
    writeFileSync(path.join(root, "cozea-devapp.json"), "not-json", "utf8");
    const service = new DevAppAuthoringService();

    expect(service.inspectFolder(root).status).toBe("invalid");
    expect(() =>
      service.scaffold({
        projectId: "project_a",
        workspaceId: "workspace_a",
        workspaceRoot: root,
        name: "Existing",
        starter: "view",
      }),
    ).toThrow(/replace existing files/);
  });

  it("keeps package paths inside the authorized workspace", () => {
    const root = temporaryWorkspace();
    const service = new DevAppAuthoringService();
    expect(() =>
      service.inspect({
        projectId: "project_a",
        workspaceId: "workspace_a",
        workspaceRoot: root,
        relativePath: "../outside",
      }),
    ).toThrow(/inside its workspace/);
  });

  it("rejects package directories that escape through a symlink", () => {
    const root = temporaryWorkspace();
    const outside = temporaryWorkspace();
    mkdirSync(path.join(root, "packages"));
    symlinkSync(outside, path.join(root, "packages", "linked"), "dir");
    const service = new DevAppAuthoringService();

    expect(() =>
      service.inspect({
        projectId: "project_a",
        workspaceId: "workspace_a",
        workspaceRoot: root,
        relativePath: "packages/linked",
      }),
    ).toThrow(/inside its workspace/);
  });

  it("creates a buildable worker-only starter", () => {
    const root = temporaryWorkspace();
    const service = new DevAppAuthoringService();
    const result = service.scaffold({
      projectId: "project_a",
      workspaceId: "workspace_a",
      workspaceRoot: root,
      name: "Worker Utility",
      starter: "worker",
    });

    expect(result.createdFiles).not.toContain("src/index.html");
    expect(readFileSync(path.join(root, "scripts/build.ts"), "utf8")).toContain(
      "worker-only DevApp",
    );
  });
});
