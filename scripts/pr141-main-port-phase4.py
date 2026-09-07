#!/usr/bin/env python3
from pathlib import Path

# Phase 4 has already been materialized on the integration branch. Keep this
# transform deliberately idempotent: later phases may rerun the one-time port
# workflow, and an already-applied gateway/workspace cutover must be accepted.
checks = {
    "apps/desktop/src/features/collaboration/api/collaborationGatewayClient.ts": [
        "requestCollaborationRepositoryCredential",
        "getDeviceGatewayBaseUrl",
    ],
    "apps/desktop/src/features/collaboration/api/downloadAuthorizedProjectRepository.ts": [
        "downloadAuthorizedProjectRepository",
        "trashManagedWorkspace",
    ],
    "apps/desktop/src/lib/deviceSession.ts": [
        "validateDeviceGatewayUrl(configured)",
        "getDeviceGatewayBaseUrl",
    ],
    "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx": [
        "downloadAuthorizedProjectRepository",
        "githubAuthorized",
    ],
}

for path, markers in checks.items():
    source = Path(path).read_text()
    missing = [marker for marker in markers if marker not in source]
    if missing:
        raise SystemExit(f"phase 4 is incomplete for {path}: missing {missing}")

print("PR141 phase 4 authorized project materialization already applied")
