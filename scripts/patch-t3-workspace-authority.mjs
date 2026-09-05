import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { patchNonresurrectingInterrupt, patchStoppedInterruptRegression } from "./patch-t3-stopped-interrupt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "// Cozea native workspace authority overlay v1\n";
const digest = text => createHash("sha256").update(text).digest("hex");
const fail = message => { throw new Error(`[cozea-workspace-authority] ${message}`); };

function parse(source, name) {
  const result = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (result.parseDiagnostics.length) fail(`Cannot parse native source ${name}.`);
  return result;
}

function propertyName(property) {
  return property.name && ts.isIdentifier(property.name) ? property.name.text : null;
}

function returnObject(source, required, name) {
  const file = parse(source, name);
  const matches = [];
  const visit = node => {
    if (ts.isReturnStatement(node) && node.expression) {
      let expression = node.expression;
      while (ts.isSatisfiesExpression(expression) || ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) expression = expression.expression;
      if (ts.isCallExpression(expression) && expression.expression.getText(file) === "TerminalManager.of" && expression.arguments.length === 1) expression = expression.arguments[0];
      if (ts.isObjectLiteralExpression(expression)) {
        const keys = new Set(expression.properties.map(propertyName));
        if (required.every(key => keys.has(key))) matches.push({ node, expression });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (matches.length !== 1) fail(`Expected one native service return in ${name}; found ${matches.length}.`);
  return { ...matches[0], file };
}

function edit(source, changes) {
  let boundary = source.length + 1;
  for (const change of [...changes].sort((a, b) => b.start - a.start)) {
    if (change.end > boundary || change.start < 0 || change.end < change.start) fail("Overlapping native source edits.");
    source = source.slice(0, change.start) + change.text + source.slice(change.end);
    boundary = change.start;
  }
  return source;
}

function once(source, before, after, name) {
  if (source.split(before).length !== 2) fail(`Native patch anchor changed: ${name}.`);
  return source.replace(before, after);
}

function patchProvider(source) {
  source = patchNonresurrectingInterrupt(source);
  const { node, expression, file } = returnObject(source, ["startSession", "sendTurn", "stopSession", "listSessions"], "ProviderService.ts");
  const names = ["startSession", "sendTurn", "compactThread", "respondToRequest", "respondToUserInput", "rollbackConversation", "uploadFeedback"];
  const changes = [];
  for (const name of names) {
    const property = expression.properties.find(item => propertyName(item) === name);
    if (!property || !ts.isShorthandPropertyAssignment(property)) fail(`Native provider method shape changed: ${name}.`);
    changes.push({ start: property.getStart(file), end: property.end, text: `${name}: (...args: Parameters<typeof ${name}>) => guardNativeProviderEffect(args, cozeaLookupProviderCwd, serverConfig.cwd, ${name}(...args))` });
  }
  changes.push({ start: node.getStart(file), end: node.getStart(file), text: `const cozeaLookupProviderCwd = async (threadId: string): Promise<string | null> => {
    const binding = await Effect.runPromise(directory.getBinding(ThreadId.make(threadId)));
    return Option.isSome(binding) ? readPersistedCwd(binding.value.runtimePayload) ?? null : null;
  };
  const cozeaUnbindProvider = bindNativeProviderStopper({
    list: () => Effect.runPromise(listSessions()),
    stop: threadId => Effect.runPromise(stopSession({ threadId: ThreadId.make(threadId) })),
    lookup: cozeaLookupProviderCwd,
  });
  yield* Effect.addFinalizer(() => Effect.sync(cozeaUnbindProvider));

  ` });
  return marker + 'import { guardNativeProviderEffect, bindNativeProviderStopper } from "../../cozeaWorkspaceEffects.ts";\n' + edit(source, changes);
}

function patchTerminal(source) {
  const { node, file } = returnObject(source, ["open", "close", "write", "subscribeMetadata"], "terminal/Manager.ts");
  return marker + 'import { installNativeTerminalAuthority } from "../cozeaWorkspaceEffects.ts";\n' + edit(source, [{
    start: node.expression.getStart(file), end: node.expression.end,
    text: `yield* installNativeTerminalAuthority(${node.expression.getText(file)})`,
  }]);
}

function patchWs(source) {
  const file = parse(source, "ws.ts");
  const candidates = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === "WsRpcGroup.of" && node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])) candidates.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (candidates.length !== 1) fail("Native RPC group shape changed.");
  const guarded = new Set([
    "ORCHESTRATION_WS_METHODS.dispatchCommand", "WS_METHODS.projectsWriteFile", "WS_METHODS.shellOpenInEditor",
    "WS_METHODS.vcsPull", "WS_METHODS.gitRunStackedAction", "WS_METHODS.gitResolvePullRequest", "WS_METHODS.gitPreparePullRequestThread",
    "WS_METHODS.vcsCreateWorktree", "WS_METHODS.vcsRemoveWorktree", "WS_METHODS.vcsCreateRef", "WS_METHODS.vcsSwitchRef", "WS_METHODS.vcsInit",
    "WS_METHODS.sourceControlPublishRepository",
  ]);
  const seen = new Set();
  const changes = [];
  for (const property of candidates[0].properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isComputedPropertyName(property.name)) continue;
    const method = property.name.expression.getText(file);
    if (!guarded.has(method)) continue;
    if (!ts.isArrowFunction(property.initializer) || property.initializer.parameters.length !== 1 || !ts.isIdentifier(property.initializer.parameters[0].name) || ts.isBlock(property.initializer.body)) fail(`Native RPC handler shape changed: ${method}.`);
    const body = property.initializer.body;
    const text = body.getText(file);
    const input = property.initializer.parameters[0].name.getText(file);
    const stream = ts.isCallExpression(body) && body.expression.getText(file) === "observeRpcStream";
    const guard = stream ? "cozeaGuardRpcStream" : "cozeaGuardRpcEffect";
    changes.push({ start: body.getStart(file), end: body.end, text: `${guard}(${method}, ${input}, ${text})` });
    seen.add(method);
  }
  if (seen.size !== guarded.size) fail(`Native RPC coverage changed: ${[...guarded].filter(method => !seen.has(method)).join(", ")}.`);
  source = edit(source, changes);
  source = once(source, "  type ProjectId,", "  ProjectId,", "RPC project identity import");
  source = once(source, "      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;", `      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
      const cozeaLookupWorkspace: NativeWorkspaceLookup = {
        project: async id => {
          const project = await Effect.runPromise(projectionSnapshotQuery.getProjectShellById(ProjectId.make(id)));
          return Option.isSome(project) ? project.value.workspaceRoot : null;
        },
        thread: async id => {
          const thread = await Effect.runPromise(projectionSnapshotQuery.getThreadShellById(ThreadId.make(id)));
          if (Option.isNone(thread)) return null;
          return thread.value.worktreePath ?? cozeaLookupWorkspace.project(thread.value.projectId);
        },
      };
      const cozeaGuardRpcEffect = <A, E, R>(method: string, input: unknown, effect: Effect.Effect<A, E, R>) =>
        guardNativeRpcEffect(method, input, cozeaLookupWorkspace, requiredScopeForRpcMethod(method), effect);
      const cozeaGuardRpcStream = <A, E, R>(method: string, input: unknown, stream: Stream.Stream<A, E, R>) =>
        guardNativeRpcStream(method, input, cozeaLookupWorkspace, requiredScopeForRpcMethod(method), stream);`, "RPC workspace lookup");
  source = once(source, ".enqueueCommand(dispatchEffect)", ".enqueueCommand(cozeaGuardRpcEffect(ORCHESTRATION_WS_METHODS.dispatchCommand, normalizedCommand, dispatchEffect))", "queued command execution guard");
  return marker + 'import { guardNativeRpcEffect, guardNativeRpcStream } from "./cozeaWorkspaceEffects.ts";\nimport type { NativeWorkspaceLookup } from "./cozeaWorkspaceControl.ts";\n' + source;
}

function patchSharedPlatform(name, source) {
  if (name === "nativeWorkspaceAuthority.ts") {
    source = once(source, 'import path from "node:path";\nimport { realpath } from "node:fs/promises";', 'import { nativeWorkspacePath as path, canonicalizeNativeWorkspacePath, scheduleNativeWorkspaceDeadline } from "./nativeWorkspacePlatform.ts";', "admission platform imports");
    source = once(source, "(this.options.canonicalize ?? realpath)", "(this.options.canonicalize ?? canonicalizeNativeWorkspacePath)", "admission canonicalization");
    source = once(source, "let timer: ReturnType<typeof setTimeout> | undefined;", "let cancelDeadline: (() => void) | undefined;", "admission deadline handle");
    source = once(source, 'timer = setTimeout(() => reject(new Error("Native workspace actions did not drain.")), this.options.drainTimeoutMs ?? 10_000);', 'cancelDeadline = scheduleNativeWorkspaceDeadline(this.options.drainTimeoutMs ?? 10_000, () => reject(new Error("Native workspace actions did not drain.")));', "admission deadline");
    source = once(source, "finally { if (timer !== undefined) clearTimeout(timer); }", "finally { cancelDeadline?.(); }", "admission deadline release");
  }
  if (name === "nativeWorkspaceIpc.ts") {
    source = once(source, 'import path from "node:path";', 'import { nativeWorkspacePath as path, scheduleNativeWorkspaceDeadline } from "./nativeWorkspacePlatform.ts";', "IPC platform import");
    source = once(source, "clearTimeout(timer);", "cancelDeadline();", "IPC deadline release");
    source = once(source, "const timer = setTimeout(onLost, timeoutMs);", "const cancelDeadline = scheduleNativeWorkspaceDeadline(timeoutMs, onLost);", "IPC deadline");
  }
  return source;
}

const transformed = new Map([
  ["apps/server/src/provider/Layers/ProviderService.ts", patchProvider],
  ["apps/server/src/provider/Layers/ProviderService.test.ts", patchStoppedInterruptRegression],
  ["apps/server/src/terminal/Manager.ts", patchTerminal],
  ["apps/server/src/ws.ts", patchWs],
]);

/**
 * Preserve unrelated native edits. Only restore a previous overlay's original
 * when its entire generated result still matches the recorded digest. A dirty
 * collision fails instead of checking out/resetting somebody else's work.
 */
export function applyCozeaWorkspaceSourcePatches({ vendorRoot, checkOnly = false }) {
  const statePath = path.join(vendorRoot, ".cozea-workspace-overlay.json");
  let state = null;
  if (fs.existsSync(statePath)) {
    try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); }
    catch { fail("Native overlay receipt is unreadable; preserve the checkout for recovery."); }
    if (state.version !== 1 || typeof state.files !== "object" || state.files === null) fail("Invalid native overlay receipt.");
  }
  const expected = new Map();
  const nextState = { version: 1, files: {} };
  for (const [relative, transform] of transformed) {
    const current = fs.readFileSync(path.join(vendorRoot, relative), "utf8");
    const previous = state?.files[relative];
    if (previous && digest(current) !== previous.after) fail(`Preserving independently modified native source: ${relative}.`);
    if (!previous && current.startsWith(marker)) fail(`Native overlay receipt is missing for ${relative}.`);
    const original = previous ? previous.original : current;
    const patched = transform(original);
    parse(patched, relative);
    expected.set(relative, patched);
    nextState.files[relative] = { original, after: digest(patched) };
  }
  const copied = new Map([
    ["nativeWorkspacePlatform.ts", "scripts/t3-runtime/nativeWorkspacePlatform.ts"],
    ["nativeWorkspaceAuthority.ts", "shared/nativeWorkspaceAuthority.ts"],
    ["nativeWorkspaceIpc.ts", "shared/nativeWorkspaceIpc.ts"],
    ["cozeaWorkspaceControl.ts", "scripts/t3-runtime/cozeaWorkspaceControl.ts"],
    ["cozeaWorkspaceEffects.ts", "scripts/t3-runtime/cozeaWorkspaceEffects.ts"],
  ]);
  for (const [name, input] of copied) {
    const relative = `apps/server/src/${name}`;
    const target = path.join(vendorRoot, relative);
    const content = patchSharedPlatform(name, fs.readFileSync(path.join(root, input), "utf8").replace('from "./nativeWorkspaceAuthority"', 'from "./nativeWorkspaceAuthority.ts"'));
    if (fs.existsSync(target)) {
      const current = fs.readFileSync(target, "utf8");
      const previous = state?.files[relative];
      if (current !== content && (!previous || digest(current) !== previous.after)) fail(`Preserving independently modified native overlay: ${relative}.`);
    }
    expected.set(relative, content);
    nextState.files[relative] = { after: digest(content) };
  }
  for (const [relative, content] of expected) {
    const target = path.join(vendorRoot, relative);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content) continue;
    if (checkOnly) fail(`Native workspace authority overlay is missing or stale: ${relative}.`);
    fs.writeFileSync(target, content);
  }
  const serialized = JSON.stringify(nextState);
  if (checkOnly) {
    if (!state || JSON.stringify(state) !== serialized) fail("Native workspace authority receipt is missing or stale.");
  } else if (!state || JSON.stringify(state) !== serialized) fs.writeFileSync(statePath, serialized);
}
