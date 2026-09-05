#!/usr/bin/env node
// Temporary isolated-checkout integration driver; removed before review.
import fs from "node:fs";

const edits = new Map();
const read = file => edits.get(file) ?? fs.readFileSync(file, "utf8");
function replace(file, before, after) {
  const source = read(file);
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one native integration anchor in ${file}: ${before.slice(0, 80)}`);
  edits.set(file, source.replace(before, after));
}

const prepare = "scripts/prepare-t3-runtime.mjs";
replace(prepare, 'import { fileURLToPath } from "node:url";', 'import { fileURLToPath } from "node:url";\nimport { applyCozeaWorkspaceSourcePatches } from "./patch-t3-workspace-authority.mjs";');
replace(prepare, "  ensureVendorCheckout(expectedPin, checkOnly);", "  ensureVendorCheckout(expectedPin, checkOnly);\n  applyCozeaWorkspaceSourcePatches({ vendorRoot, checkOnly });");

const manager = "apps/desktop/electron/substrate/ShadowServerManager.ts";
replace(manager, 'import fs from "node:fs";', 'import fs from "node:fs";\nimport { trackNativeWorkspaceEndpoint } from "../collaboration/NativeWorkspaceBridge";');
replace(manager, "    this.child = child;", "    this.child = child;\n    trackNativeWorkspaceEndpoint(child);");

const processFile = "apps/server/src/t3/process.ts";
replace(processFile, 'import fs from "node:fs";', 'import fs from "node:fs";\nimport { isNativeWorkspaceAuthorizeRequest, requestNativeWorkspaceDecision, requestNativeWorkspaceControl, sendNativeWorkspaceMessage } from "../../../../shared/nativeWorkspaceIpc.ts";');
replace(processFile, "  readonly controlUpdate: (request: HostUpdateRequest) => Promise<void>;", "  readonly controlUpdate: (request: HostUpdateRequest) => Promise<void>;\n  readonly controlWorkspace: (action: \"stop\" | \"activate\", root: string) => Promise<void>;");
replace(processFile, 'env: { ...nodeLaunch.environment, COZEA_HOST_CONTINUATION: "1" },', 'env: { ...nodeLaunch.environment, COZEA_HOST_CONTINUATION: "1", COZEA_NATIVE_WORKSPACE_AUTHORITY: "1" },');
replace(processFile, '  child.stdout?.on("data", (chunk: Buffer) => startupOutput.append("stdout", chunk));', `  child.on("message", (message: unknown) => {
    if (!isNativeWorkspaceAuthorizeRequest(message)) return;
    void requestNativeWorkspaceDecision(process, message.cwd, message.operation).then(
      decision => sendNativeWorkspaceMessage(child, { type: "cozea:workspace-authorize-result", requestId: message.requestId, ...decision }),
      () => sendNativeWorkspaceMessage(child, { type: "cozea:workspace-authorize-result", requestId: message.requestId, allowed: false, sessionRoot: null }),
    );
  });
  child.stdout?.on("data", (chunk: Buffer) => startupOutput.append("stdout", chunk));`);
replace(processFile, "    controlUpdate: (request) => requestHostUpdate(child, request),", "    controlUpdate: (request) => requestHostUpdate(child, request),\n    controlWorkspace: (action, root) => requestNativeWorkspaceControl(child, action, root),");

const bootstrap = "apps/server/src/bootstrap.ts";
replace(bootstrap, 'import fs from "node:fs";', 'import fs from "node:fs";\nimport { isNativeWorkspaceControlRequest, sendNativeWorkspaceMessage } from "../../../shared/nativeWorkspaceIpc.ts";');
replace(bootstrap, '  process.on("message", onHostUpdate);', `  const onWorkspaceControl = (message: unknown) => {
    if (!isNativeWorkspaceControlRequest(message)) return;
    const operation = t3Handle?.process.controlWorkspace(message.action, message.root) ?? Promise.reject(new Error("Native chat server is unavailable."));
    const reply = (success: boolean) => sendNativeWorkspaceMessage(process, {
      type: "cozea:workspace-control-result", requestId: message.requestId, action: message.action, success,
    });
    void operation.then(() => reply(true), () => reply(false));
  };
  process.on("message", onWorkspaceControl);
  process.on("message", onHostUpdate);`);
replace(bootstrap, '      process.off("message", onHostUpdate);', '      process.off("message", onHostUpdate);\n      process.off("message", onWorkspaceControl);');

const handlers = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts";
replace(handlers, 'import { WorkbenchSessionManager } from "../services/WorkbenchSessionManager"', 'import { WorkbenchSessionManager } from "../services/WorkbenchSessionManager"\nimport { blockNativeWorkspaceRoot, setNativeWorkspaceAuthorizer, stopNativeWorkspaceRoot } from "./NativeWorkspaceBridge"\nimport { createNativeWorkspaceAuthorizer } from "./NativeWorkspaceAuthorizer"');
replace(handlers, '{ projectId, slug: `collab-${sessionId}`, setActive: false }, prepare, `collaboration:g3:${sessionId}`,', '{ projectId, slug: `collab-${sessionId}`, setActive: false }, async target => { blockNativeWorkspaceRoot(target); await prepare(target) }, `collaboration:g3:${sessionId}`,');
replace(handlers, "  const host = new SessionRuntimeHost(coordinator,", `  setNativeWorkspaceAuthorizer(createNativeWorkspaceAuthorizer({
    findWorkspace: cwd => catalog(service => service.findByPath(cwd)),
    binding: workspaceId => coordinator.bindingForWorkspace(workspaceId),
    authorizeSession: sessionId => gateway.post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId }),
  }))
  const host = new SessionRuntimeHost(coordinator,`);
replace(handlers, "  }, workspaceId => WorkbenchSessionManager.getInstance().closeWorkspace(workspaceId))", `  }, async workspaceId => {
    const workspace = await catalog(service => service.getById(workspaceId))
    if (!workspace) throw new Error("The retained session workspace could not be resolved for shutdown")
    const results = await Promise.allSettled([
      stopNativeWorkspaceRoot(workspace.projectRootPath),
      WorkbenchSessionManager.getInstance().closeWorkspace(workspaceId),
    ])
    if (results.some(result => result.status === "rejected")) throw new Error("Session workspace shutdown was not fully acknowledged; retry Leave")
  })`);

const host = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
replace(host, 'import { safeStorage } from "electron"', 'import { safeStorage } from "electron"\nimport { activateNativeWorkspaceRoot } from "./NativeWorkspaceBridge"');
replace(host, "      hosted.ready = true", "      await activateNativeWorkspaceRoot(workspace.projectRootPath)\n      hosted.ready = true");

const bridge = "apps/desktop/electron/collaboration/NativeWorkspaceBridge.ts";
replace(bridge, "  const targets = [...endpoints].filter(endpoint => endpoint.connected);", "  // A disconnected but not exited child is an unconfirmed owner, not success.\n  const targets = [...endpoints];");

const authorizer = "apps/desktop/electron/collaboration/NativeWorkspaceAuthorizer.ts";
replace(authorizer, '      if (!path.isAbsolute(request.cwd) || request.cwd.includes("\\0")) return { allowed: false, sessionRoot };', '      if ((request.operation !== "execute" && request.operation !== "git") || !path.isAbsolute(request.cwd) || request.cwd.includes("\\0")) return { allowed: false, sessionRoot };');
replace(authorizer, '      if (live.role !== "editor" || !Number.isFinite(live.expiresAt) || live.expiresAt <= now()) return { allowed: false, sessionRoot };', '      if (live.role !== "editor" || live.session.id !== binding.sessionId || live.session.projectId !== binding.projectId || live.session.repositoryId !== binding.repositoryId || ["closing", "closed", "failed"].includes(live.session.status) || !Number.isFinite(live.expiresAt) || live.expiresAt <= now()) return { allowed: false, sessionRoot };');

const authority = "shared/nativeWorkspaceAuthority.ts";
replace(authority, '      if (failed) throw new Error("Native workspace shutdown was not fully acknowledged; retry Leave.");', '      if (failed) throw new Error("Native workspace shutdown was not fully acknowledged; retry Leave.");\n      this.sessionRoots.delete(root);');

const test = "tests/collaboration/nativeWorkspaceAuthority.test.ts";
replace(test, 'function fixture(authorize = vi.fn(async (_cwd: string, _operation: "execute" | "git") => editor)) {\n  return { authorize, authority: new NativeWorkspaceAuthority({ authorize, canonicalize: async cwd => cwd, drainTimeoutMs: 10 }) };\n}', 'function fixture(implementation: (cwd: string, operation: "execute" | "git") => Promise<NativeWorkspaceDecision> = async () => editor) {\n  const authorize = vi.fn(implementation);\n  return { authorize, authority: new NativeWorkspaceAuthority({ authorize, canonicalize: async cwd => cwd, drainTimeoutMs: 10 }) };\n}');

for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}
