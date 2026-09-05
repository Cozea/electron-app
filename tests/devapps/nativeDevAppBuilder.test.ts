import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyNativeDevAppImport,
  createNativeDevAppBuildPlan,
  nativeDevAppRuntimeModuleId,
  validateScopedDevAppCss,
} from "../../scripts/devapps/native-builder";
import { nativeDevAppRuntimeProxySource } from "@shared/nativeDevAppRuntime";

const fixtureRoot = path.join(process.cwd(), "examples/native-devapps/counter");

describe("native DevApp builder boundary", () => {
  it("maps host runtime modules without bundling another React", () => {
    expect(classifyNativeDevAppImport("react")).toBe("host-runtime");
    expect(classifyNativeDevAppImport("react/jsx-runtime")).toBe("host-runtime");
    expect(classifyNativeDevAppImport("@cozea/devapp-api/native")).toBe("host-runtime");
    expect(classifyNativeDevAppImport("@cozea/devapp-api/ui")).toBe("host-runtime");
    const virtualId = nativeDevAppRuntimeModuleId("react")
    expect(virtualId).toContain("cozea:native-runtime:react")
    expect(nativeDevAppRuntimeProxySource(virtualId!)).toContain("api.useState")
  });

  it("blocks Electron, Node, renderer internals, nested React roots, and the extension SDK", () => {
    expect(classifyNativeDevAppImport("electron")).toBe("forbidden");
    expect(classifyNativeDevAppImport("node:fs")).toBe("forbidden");
    expect(classifyNativeDevAppImport("@/features/projects")).toBe("forbidden");
    expect(classifyNativeDevAppImport("react-dom/client")).toBe("forbidden");
    expect(classifyNativeDevAppImport("react/compiler-runtime")).toBe("forbidden");
    expect(classifyNativeDevAppImport("@cozea/devapp-api/extension")).toBe("forbidden");
    expect(classifyNativeDevAppImport("date-fns")).toBe("bundled");
  });

  it("requires package CSS to stay under the app host selector", async () => {
    expect(
      await validateScopedDevAppCss(
        '[data-cozea-devapp="dev.example"] .root { display: grid; }',
        "dev.example",
      ),
    ).toEqual([]);
    expect(
      await validateScopedDevAppCss("body { margin: 0; }", "dev.example"),
    ).toEqual(["body"]);
  });

  it("creates a confined native build plan for the Counter fixture", async () => {
    const plan = await createNativeDevAppBuildPlan({ packageRoot: fixtureRoot });
    expect(plan.manifest.id).toBe("dev.cozea.examples.counter");
    expect(plan.rendererModules.map((module) => module.id)).toEqual(["main"]);
    expect(plan.extensionPath).toBe(path.join(fixtureRoot, "src/extension.ts"));
    expect(plan.webSurfaceIds).toEqual([]);
    expect(fs.existsSync(plan.rendererModules[0]!.entryPath)).toBe(true);
  });
});
