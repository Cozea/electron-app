import { useEffect, useState } from "react";
import type { LocalProjectDTO } from "@shared/localProjectTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { requireLocalProjectsApi } from "@/features/projects/lib/localProjectsApi";
import { updateLocalProjectPresentation } from "@/features/projects/lib/localProjectDiscovery";
import { useNavigateTo } from "@/lib/navigation";
import {
  SettingsGroup,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "./SettingsChrome";
import { cn } from "@/lib/utils";
import { LocalProjectRecoveryPanel } from "@/features/projects/ui/LocalProjectRecoveryPanel";
import { useWorkspaceSnapshotEntry } from "@/features/workspace/useWorkspaceCatalogSnapshot";
import { useProjectWorkspaceActions } from "@/features/workspace/hooks/useProjectWorkspaceActions";

interface LocalProjectSettingsProps {
  project: LocalProjectDTO;
  sharedAvailable: boolean;
}

export function LocalProjectSettings({ project, sharedAvailable }: LocalProjectSettingsProps) {
  const navigateTo = useNavigateTo();
  const [name, setName] = useState(project.name);
  const [removeData, setRemoveData] = useState(false);
  const [trashFolders, setTrashFolders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const entry = useWorkspaceSnapshotEntry(project.projectId);
  const { relinkProjectWorkspace, closeProjectWorkspace } = useProjectWorkspaceActions();
  useEffect(() => {
    setName(project.name);
    setError(null);
  }, [project.projectId, project.name]);

  async function save(metadata: { localName?: string | null; hidden?: boolean }) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateLocalProjectPresentation(requireLocalProjectsApi(), project.projectId, metadata);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollArea className="scroll-fade-y h-full">
      <div className="mx-auto max-w-4xl px-8 pt-6 pb-12 sm:px-10">
        <SettingsPageHeader title={project.name} />
        <p className="mb-6 text-sm text-muted-foreground">Project preferences on this device.</p>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title="Local name"
              description="The name shown on this device."
              htmlFor="local-project-name"
            />
            <SettingsRowControl className="gap-3">
              <Input
                id="local-project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                className={cn(settingsInlineInputClass, settingsInlineInputWidth)}
              />
              <Button
                size="sm"
                disabled={busy || !name.trim() || name.trim() === project.name}
                onClick={() => void save({ localName: name.trim() })}
              >
                Save
              </Button>
            </SettingsRowControl>
          </SettingsRow>
          {project.cloudProjectId && project.localName !== null ? (
            <SettingsRow>
              <SettingsRowLabel
                title="Use shared name"
                description={project.sharedName ?? "Use the name recorded for collaborators."}
              />
              <SettingsRowControl>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void save({ localName: null })}
                >
                  Use Shared Name
                </Button>
              </SettingsRowControl>
            </SettingsRow>
          ) : null}
          <SettingsRow>
            <SettingsRowLabel
              title="Hide on this device"
              description="Hidden projects remain available in Search and Show hidden projects."
              htmlFor="local-project-hidden"
            />
            <SettingsRowControl>
              <Switch
                id="local-project-hidden"
                checked={project.hidden}
                disabled={busy}
                onCheckedChange={(hidden) => void save({ hidden })}
              />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
        {entry ? (
          <div className="mt-6 space-y-3">
            <p className="break-all text-sm text-muted-foreground">Local folder: {entry.workspace.displayPath}</p>
            <p className="text-sm text-muted-foreground">Closing stops local runtimes and keeps files, conversations, drafts and layouts.</p>
            <Button variant="outline" disabled={busy} onClick={() => {
              setBusy(true);
              void closeProjectWorkspace({ id: project.projectId, _id: project.cloudProjectId, name: project.name, slug: project.slug }, entry.workspace.workspaceId)
                .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
                .finally(() => { setBusy(false); setRecoveryRevision((revision) => revision + 1); });
            }}>Close Workspace</Button>
            {entry.status === "broken" ? <Button variant="outline" disabled={busy} onClick={() => {
              setBusy(true);
              void relinkProjectWorkspace({ id: project.projectId, _id: project.cloudProjectId, name: project.name, slug: project.slug }, entry.workspace.workspaceId)
                .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
                .finally(() => { setBusy(false); setRecoveryRevision((revision) => revision + 1); });
            }}>Locate Original Folder</Button> : null}
          </div>
        ) : null}
        <SettingsGroup className="mt-6">
          <SettingsRow isFirst>
            <SettingsRowLabel title="Erase local conversations and data" description="When removing this project, erase its native chat history, drafts, layouts and device preferences." htmlFor="remove-project-data" />
            <SettingsRowControl><Switch id="remove-project-data" checked={removeData} disabled={busy} onCheckedChange={setRemoveData} /></SettingsRowControl>
          </SettingsRow>
          <SettingsRow>
            <SettingsRowLabel title="Move managed folders to Trash" description="Only folders created and owned by Cozea qualify. Attached folders always stay on disk." htmlFor="trash-project-folders" />
            <SettingsRowControl><Switch id="trash-project-folders" checked={trashFolders} disabled={busy} onCheckedChange={setTrashFolders} /></SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">Remove from this device stops local runtimes and detaches every workspace. Shared projects and installed organization apps remain available.</p>
          <Button variant="destructive" disabled={busy} onClick={() => {
            setBusy(true); setError(null);
            void (async () => {
              const confirmation = await window.electronAPI.dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Remove from This Device"], defaultId: 0, cancelId: 0,
                title: "Remove from This Device", message: `Remove ${project.name} from this device?`,
                detail: `${removeData ? "Erase this project's local conversations, drafts and layouts." : "Keep this project's conversations, drafts and layouts."} ${trashFolders ? "Move catalog-proven managed folders to Trash." : "Keep all source folders."} Attached folders stay on disk. Running chats and retained collaboration sessions must be stopped or left explicitly first.`,
              });
              if (confirmation.response !== 1) return;
              const result = await requireLocalProjectsApi().remove({ operationId: crypto.randomUUID(), projectId: project.projectId, removeLocalData: removeData, trashManagedFolder: trashFolders });
              if (!result.success) throw new Error(result.error);
              navigateTo({ to: "projects" }, { replace: true });
            })().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
              .finally(() => { setBusy(false); setRecoveryRevision((revision) => revision + 1); });
          }}>Remove from This Device</Button>
        </div>
        <LocalProjectRecoveryPanel key={recoveryRevision} projectId={project.projectId} />
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {project.cloudProjectId ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              Shared settings change the project for collaborators.
            </p>
            <Button
              variant="outline"
              disabled={!sharedAvailable}
              onClick={() =>
                navigateTo({
                  to: "projectSettings",
                  projectId: project.projectId,
                  section: "shared",
                })
              }
            >
              Open Shared Settings
            </Button>
            {!sharedAvailable ? (
              <p className="text-sm text-muted-foreground">
                Shared settings are currently unavailable.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
