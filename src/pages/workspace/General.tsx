import { useState, useEffect } from "react";
import { useViewTransitionNavigate } from "@/lib/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { WorkspaceAccessNotice } from "@/components/workspaces/WorkspaceAccessNotice";
import { WorkspaceIdentityPicker } from "@/components/workspaces/WorkspaceIdentityPicker";
import {
  SettingsDangerGroup,
  SettingsFooterActions,
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsInlineInputClass,
  settingsInlineInputWidth,
} from "@/components/settings/SettingsChrome";
import { useScopedGeneralData } from "@/hooks/useScopedGeneralData";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { ArrowPathIcon as Loader2, ArrowPathIcon as RotateCcw, CheckIcon as Check, ExclamationTriangleIcon as AlertTriangle, TrashIcon as Trash2, XMarkIcon as X } from "@heroicons/react/24/outline"
import { sanitizeWorkspaceIdentityInput, type WorkspaceIdentityInput } from "@shared/workspaceIdentity.ts";
import { cn } from "@/lib/utils";

interface GeneralProps {
  surface?: "page" | "drawer";
  route?: string;
}

export function General({ surface = "page", route }: GeneralProps = {}) {
  const navigate = useViewTransitionNavigate();
  const { logout } = useAuth();
  const {
    settingsPage,
    convexUserId,
    convexOrg,
    workspaceOrganizationId,
    canManageGeneral,
    updateWorkosOrganization,
    deleteWorkosOrganization,
    isLoading,
  } = useScopedGeneralData({ route });

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceIdentity, setWorkspaceIdentity] = useState<WorkspaceIdentityInput>({});
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const updateOrganization = useMutation(api.organizations.updateOrganization);
  const deleteOrganization = useMutation(api.organizations.deleteOrganization);

  const [isFormInitialized, setIsFormInitialized] = useState(false);

  useEffect(() => {
    if (convexOrg && !isFormInitialized) {
      setWorkspaceName(convexOrg.name);
      setWorkspaceSlug(convexOrg.slug);
      setWorkspaceIdentity(
        sanitizeWorkspaceIdentityInput({
          iconKey: convexOrg.iconKey,
          iconColor: convexOrg.iconColor,
        }),
      );
      setIsFormInitialized(true);
    }
  }, [convexOrg, isFormInitialized]);

  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => setSaveSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  const handleSave = async () => {
    if (!convexOrg || !convexUserId || !canManageGeneral) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const isWorkspaceScoped = settingsPage.workspaceScoped;

      if (isWorkspaceScoped && workspaceOrganizationId && workspaceName !== convexOrg.name) {
        const workosResult = await updateWorkosOrganization(workspaceOrganizationId, workspaceName);
        if (!workosResult) {
          throw new Error("Failed to update organization in WorkOS");
        }
      }

      await updateOrganization({
        orgId: convexOrg._id,
        userId: convexUserId,
        name: workspaceName,
        slug: isWorkspaceScoped ? workspaceSlug : undefined,
        iconKey: workspaceIdentity.iconKey ?? null,
        iconColor: workspaceIdentity.iconKey ? (workspaceIdentity.iconColor ?? null) : null,
      });
      setSaveSuccess(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!convexOrg || !convexUserId || !workspaceOrganizationId || !canManageGeneral) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      if (deleteConfirmName !== convexOrg.name) {
        throw new Error("Workspace name does not match");
      }

      const workosResult = await deleteWorkosOrganization(workspaceOrganizationId);
      if (!workosResult) {
        throw new Error("Failed to delete organization from WorkOS");
      }

      await deleteOrganization({
        orgId: convexOrg._id,
        userId: convexUserId,
        confirmName: deleteConfirmName,
      });

      await logout();
      navigate("/");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete workspace");
      setIsDeleting(false);
    }
  };

  const hasChanges =
    isFormInitialized &&
    (workspaceName !== convexOrg?.name ||
      (settingsPage.workspaceScoped && workspaceSlug !== convexOrg?.slug) ||
      (workspaceIdentity.iconKey ?? null) !== (convexOrg?.iconKey ?? null) ||
      (workspaceIdentity.iconColor ?? null) !== (convexOrg?.iconColor ?? null));

  const isWorkspaceScoped = settingsPage.workspaceScoped;

  const content = (
    <>
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Workspace access required"
          description="You do not have permission to view this workspace."
        />
      ) : (
        <SettingsPageBody surface={surface}>
          {settingsPage.hasResolvedWorkspaceAccess && !canManageGeneral ? (
            <p className="mb-3 px-1 text-[11px] text-muted-foreground">
              You can view workspace details, but only owners or admins with organization update access can
              edit them.
            </p>
          ) : null}

          <section>
            <SettingsSectionTitle>{isWorkspaceScoped ? "Workspace" : "Personal workspace"}</SettingsSectionTitle>
            <SettingsSectionDescription>
              {isWorkspaceScoped
                ? "Name, URL, and how this workspace appears in the app."
                : "How your personal workspace appears in the app."}
            </SettingsSectionDescription>
            <div className="space-y-7">
              <SettingsGroup>
                <SettingsRow isFirst>
                  <SettingsRowLabel title="Workspace name" htmlFor="ws-name" />
                  <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                    <Input
                      id="ws-name"
                      value={workspaceName}
                      onChange={(e) => setWorkspaceName(e.target.value)}
                      disabled={isLoading || !canManageGeneral}
                      className={cn(settingsInlineInputClass, "w-full text-[13px] font-normal")}
                    />
                  </SettingsRowControl>
                </SettingsRow>

                {isWorkspaceScoped ? (
                  <SettingsRow>
                    <SettingsRowLabel
                      title="Workspace URL"
                      htmlFor="ws-slug"
                      description="Used in shared links."
                      descriptionClassName="truncate"
                    />
                    <SettingsRowControl className={cn("min-w-0", settingsInlineInputWidth)}>
                      <div className="ml-auto inline-flex max-w-full items-center justify-end gap-0.5 whitespace-nowrap">
                          <span className="shrink-0 text-[13px] text-muted-foreground">app.cozea.io/</span>
                          <Input
                            id="ws-slug"
                            value={workspaceSlug}
                            onChange={(e) =>
                              setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                            }
                            className={cn(settingsInlineInputClass, "w-[11ch] min-w-[11ch] text-[13px] font-normal")}
                            disabled={isLoading || !canManageGeneral}
                          />
                      </div>
                    </SettingsRowControl>
                  </SettingsRow>
                ) : null}
              </SettingsGroup>

              <WorkspaceIdentityPicker
                layout="groups"
                workspaceType={isWorkspaceScoped ? "organization" : "personal"}
                workspaceName={workspaceName || "Workspace"}
                value={workspaceIdentity}
                onChange={setWorkspaceIdentity}
                disabled={isLoading || !canManageGeneral}
              />

              {saveError ? (
                <p className="px-1 text-[11px] text-destructive">
                  <span className="inline-flex items-center gap-2">
                    <X className="size-3.5 shrink-0" />
                    {saveError}
                  </span>
                </p>
              ) : null}
              {saveSuccess ? (
                <p className="px-1 text-[11px] text-emerald-600 dark:text-emerald-500">
                  <span className="inline-flex items-center gap-2">
                    <Check className="size-3.5 shrink-0" />
                    Changes saved successfully
                  </span>
                </p>
              ) : null}

              <SettingsFooterActions>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 rounded-full px-2.5 text-xs font-normal"
                    onClick={() => setWorkspaceIdentity({})}
                    disabled={isLoading || !canManageGeneral || (!workspaceIdentity.iconKey && !workspaceIdentity.iconColor)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset style
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1.5 rounded-full px-2.5 text-xs"
                    onClick={() => void handleSave()}
                    disabled={isLoading || isSaving || !hasChanges || !canManageGeneral}
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </Button>
                </div>
              </SettingsFooterActions>
            </div>
          </section>

          {isWorkspaceScoped ? (
            <section>
              <SettingsSectionTitle variant="danger">
                <AlertTriangle className="size-3.5" aria-hidden />
                Danger zone
              </SettingsSectionTitle>
              <SettingsDangerGroup>
                <SettingsRow isFirst borderClassName="border-destructive/20">
                  <SettingsRowLabel
                    title="Delete workspace"
                    description="Permanently delete this workspace and all its data"
                  />
                  <SettingsRowControl>
                    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 gap-1.5 text-[11px]"
                          disabled={!canManageGeneral}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete workspace</DialogTitle>
                          <DialogDescription>
                            This action cannot be undone. All projects, data, and members will be permanently
                            removed.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label>
                              Type <span className="font-semibold">{convexOrg?.name}</span> to confirm
                            </Label>
                            <Input
                              placeholder={convexOrg?.name}
                              value={deleteConfirmName}
                              onChange={(e) => setDeleteConfirmName(e.target.value)}
                            />
                          </div>
                          {deleteError ? (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                              <X className="h-4 w-4" />
                              {deleteError}
                            </div>
                          ) : null}
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setDeleteDialogOpen(false);
                              setDeleteConfirmName("");
                              setDeleteError(null);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => void handleDelete()}
                            disabled={isDeleting || deleteConfirmName !== convexOrg?.name}
                          >
                            {isDeleting ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Deleting…
                              </>
                            ) : (
                              "Delete workspace"
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </SettingsRowControl>
                </SettingsRow>
              </SettingsDangerGroup>
            </section>
          ) : null}
        </SettingsPageBody>
      )}
    </>
  );

  if (surface === "drawer") {
    return content;
  }

  return content;
}
