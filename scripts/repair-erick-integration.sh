#!/usr/bin/env bash
set -euo pipefail

# The assistant provider-instance model was left in the old project component
# bucket while its consumers moved into the assistant feature.
if [[ -f apps/desktop/src/features/projects/components/providerInstances.ts && ! -e apps/desktop/src/features/assistant/providerInstances.ts ]]; then
  git mv \
    apps/desktop/src/features/projects/components/providerInstances.ts \
    apps/desktop/src/features/assistant/providerInstances.ts
  cat > apps/desktop/src/features/projects/components/providerInstances.ts <<'EOF'
/** Compatibility facade. Provider instances are owned by the assistant feature. */
export * from "@/features/assistant/providerInstances"
EOF
fi

python3 <<'PY'
from pathlib import Path

root = Path.cwd()

replacements_by_file = {
    "apps/desktop/src/pages/settings/Tooling.tsx": [
        ('export * from "@/features/settings/pages/Tooling"', 'export * from "@/features/settings/Tooling"'),
    ],
    "apps/desktop/src/features/settings/pages/Tooling.tsx": [
        ('export { Tooling } from "@/features/settings/Tooling"', 'export * from "@/features/settings/Tooling"'),
    ],
    "apps/desktop/src/features/assistant/providerInstances.ts": [
        ('from "./assistant/chat/providerIconUtils"', 'from "./chat/providerIconUtils"'),
    ],
    "apps/desktop/src/features/assistant/chat/ChangedFilesTree.tsx": [
        ('from "../../NativeProjectFolderIcon"', 'from "@/features/projects/ui/NativeProjectFolderIcon"'),
    ],
    "apps/desktop/src/features/assistant/chat/ModelPickerContent.tsx": [
        ('from "../../providerInstances"', 'from "@/features/assistant/providerInstances"'),
    ],
    "apps/desktop/src/features/assistant/chat/ModelPickerSidebar.tsx": [
        ('from "../../providerInstances"', 'from "@/features/assistant/providerInstances"'),
    ],
    "apps/desktop/src/features/assistant/chat/ProviderModelPicker.tsx": [
        ('from "../../providerInstances"', 'from "@/features/assistant/providerInstances"'),
    ],
    "apps/desktop/src/features/source-control/hooks/useGitDirtySnapshot.ts": [
        ("from '../../../../shared/electronApiTypes'", "from '@shared/electronApiTypes'"),
    ],
    "apps/desktop/src/features/source-control/model/gitRemoteStatusCache.ts": [
        ('from "./connectionStatusModel"', 'from "@/features/collaboration/model/connectionStatusModel"'),
    ],
    "apps/desktop/src/features/tasks/pages/TasksPage.tsx": [
        ("from '../contexts/ProjectSyncContext'", "from '@/features/projects/contexts/ProjectSyncContext'"),
        ("from '@/features/projects/lib/taskFocusOverlay'", "from '@/features/tasks/model/taskFocusOverlay'"),
    ],
    "apps/desktop/src/features/workspace/ActiveWorkspaceContext.tsx": [
        ('from "../../../../../../shared/workspaceTypes"', 'from "@shared/workspaceTypes"'),
    ],
    "apps/desktop/src/features/workspace/WorkspaceRepairScreen.tsx": [
        ('from "../../../../../../shared/workspaceTypes"', 'from "@shared/workspaceTypes"'),
    ],
    "apps/desktop/src/features/workspace/useWorkspaceCatalogSnapshot.ts": [
        ('from "../../../../../../shared/workspaceTypes"', 'from "@shared/workspaceTypes"'),
    ],
    "apps/desktop/src/features/workspace/useWorkspaceRuntimeStore.ts": [
        ('from "../../../../../../convex/_generated/dataModel"', 'from "../../../../../convex/_generated/dataModel"'),
        ('from "@/features/projects/workspaces/workspaceIdentity"', 'from "@/features/workspace/workspaceIdentity"'),
    ],
    "tests/assistant/chat/composerDraftStore.test.ts": [
        (
            "../../../apps/desktop/src/features/projects/components/assistant/chat/composerDraftStore",
            "../../../apps/desktop/src/features/assistant/chat/composerDraftStore",
        ),
    ],
    "tests/assistant/chat/modelPickerDismissal.test.ts": [
        (
            "../../../apps/desktop/src/features/projects/components/assistant/chat/modelPickerDismissal",
            "../../../apps/desktop/src/features/assistant/chat/modelPickerDismissal",
        ),
    ],
    "tests/assistant/composerSlashCommands.test.ts": [
        (
            "../../apps/desktop/src/features/projects/components/assistant/composer-logic",
            "../../apps/desktop/src/features/assistant/composer-logic",
        ),
        (
            "../../apps/desktop/src/features/projects/components/assistant/composer-editor-mentions",
            "../../apps/desktop/src/features/assistant/composer-editor-mentions",
        ),
    ],
    "tests/substrate/assistantTileBootstrap.test.ts": [
        (
            "../../apps/desktop/src/features/projects/components/workbench/assistant/workbenchAssistantShared",
            "../../apps/desktop/src/features/workbench/assistant/workbenchAssistantShared",
        ),
    ],
    "tests/substrate/threadDetailStore.test.ts": [
        (
            "../../apps/desktop/src/features/projects/components/assistant/chat/MessagesTimeline.logic",
            "../../apps/desktop/src/features/assistant/chat/MessagesTimeline.logic",
        ),
    ],
}

for relative, replacements in replacements_by_file.items():
    path = root / relative
    if not path.exists():
        raise SystemExit(f"Expected integration file is missing: {relative}")
    text = path.read_text(encoding="utf-8")
    original = text
    for old, new in replacements:
        text = text.replace(old, new)
    if text == original:
        print(f"No textual change needed: {relative}")
    path.write_text("\n".join(line.rstrip() for line in text.splitlines()).rstrip() + "\n", encoding="utf-8")

# Canonicalize any remaining absolute imports to the provider-instance model.
for path in (root / "apps/desktop/src").rglob("*.ts*"):
    if not path.is_file():
        continue
    text = path.read_text(encoding="utf-8")
    updated = text.replace(
        '@/features/projects/components/providerInstances',
        '@/features/assistant/providerInstances',
    )
    if updated != text:
        path.write_text("\n".join(line.rstrip() for line in updated.splitlines()).rstrip() + "\n", encoding="utf-8")
PY

git rm -f --ignore-unmatch scripts/repair-erick-integration.sh
git add -A
git diff --cached --check
git commit --amend --no-edit
