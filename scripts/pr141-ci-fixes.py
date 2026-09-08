#!/usr/bin/env python3
from pathlib import Path

# The legacy compatibility host is intentionally local-only after the gen-3
# cutover. Prefix the retained public prop to make that intent compile-clean.
runtime_path = Path("apps/desktop/src/contexts/project/ProjectSyncProviderRuntime.tsx")
runtime = runtime_path.read_text()
runtime = runtime.replace(
    "  collaborationEnabled = true,\n",
    "  collaborationEnabled: _collaborationEnabled = true,\n",
    1,
)
runtime_path.write_text(runtime)

# Narrow the optional checkpoint once, then use the narrowed value for rotation
# activation so Cloudflare's strict typecheck cannot observe an undefined read.
route_path = Path("cloudflare/worker/src/routes/collaborationRepositories.ts")
route = route_path.read_text()
old = '''  const result = await response.json() as { checkpoint?: { keyVersion: number; sequence: number } }\n  if (body.rotation === true && authority.previousKeyVersion && result.checkpoint?.keyVersion === authority.keyVersion) {\n    await client.mutation(makeFunctionReference<\"mutation\">(\"collaborationEncryption:activateRotationFromServer\"),\n      { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: result.checkpoint.sequence })\n  }\n'''
new = '''  const result = await response.json() as { checkpoint?: { keyVersion: number; sequence: number } }\n  const checkpoint = result.checkpoint\n  if (body.rotation === true && authority.previousKeyVersion && checkpoint?.keyVersion === authority.keyVersion) {\n    await client.mutation(makeFunctionReference<\"mutation\">(\"collaborationEncryption:activateRotationFromServer\"),\n      { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: checkpoint.sequence })\n  }\n'''
if old not in route and new not in route:
    raise RuntimeError("checkpoint narrowing anchor changed")
route = route.replace(old, new, 1)
route_path.write_text(route)

# The desktop-first architecture invariant changed intentionally: a Git branch
# never implies live collaboration. Assert explicit session binding instead.
test_path = Path("tests/architecture/desktopFirstLoadingPolicy.test.ts")
test = test_path.read_text()
test = test.replace(
    "    expect(source).toContain('Boolean(project?._id) && activeBranch === collabBranch')\n",
    "    expect(source).toContain('const collaborationEnabled = Boolean(shouldEnableProjectRuntime && runtimeWorkspaceId && project?._id && activeCollaborationBinding)')\n    expect(source).not.toContain('activeBranch === collabBranch')\n",
    1,
)
test_path.write_text(test)

print("PR141 final CI compatibility fixes applied")
