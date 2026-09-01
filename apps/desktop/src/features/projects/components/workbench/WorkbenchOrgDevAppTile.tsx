import { useEffect, useMemo, useState } from "react";
import type { DockviewApi, DockviewPanelApi } from "dockview-react";
import { useQuery } from "convex/react";

import { api } from "../../../../../../../convex/_generated/api";
import { BrowserSurfaceSlot } from "@/features/projects/browser/BrowserSurfaceSlot";
import {
  browserSurfaceRuntimeTabId,
  resolveBrowserWorkbenchSessionKey,
} from "@/features/projects/browser/browserSurfaceIdentity";
import { resolveBrowserPageError } from "@/features/projects/browser/browserPageError";
import { useHostedBrowserSurface } from "@/features/projects/browser/browserSurfaceRegistry";
import { useDockviewBrowserSurfacePresentation } from "@/features/projects/browser/useDockviewBrowserSurfaceLayer";
import { useBrowserSurfaceStateStore } from "@/features/projects/browser/browserSurfaceStateStore";
import { useAuth } from "@/contexts/AuthContext";
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome";
import { useWorkbenchPanelActivityMode } from "@/features/projects/components/workbench/useWorkbenchPanelActivityMode";
import type { WorkbenchOrgDevAppTile as WorkbenchOrgDevAppTileRecord } from "@/stores/useProjectWorkbenchStore";
import { useTranslation } from "@/lib/i18n";
import { getDeviceGatewayBaseUrl, getDeviceSession } from "@/lib/deviceSession";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";
import type { OrgDevAppRuntimeState } from "@shared/orgDevAppRuntime";
import type { OrgDevAppEnvironmentStatus } from "@shared/orgDevAppEnvironment";
import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation";
import type { DevAppParts } from "@shared/devAppParts";
import type { DevAppCapability } from "@shared/devAppCapabilities";
import type { DevAppFolderGrant } from "@shared/devAppContainedRuntime";

interface ResolvedOrgDevAppArtifact {
  url: string;
  publicationId: string;
  organizationId: string;
  contentHash: string;
  entryPath: string;
  releaseId: string;
  version: number;
  runtimeKind: "static" | "service";
  manifestVersion: number | null;
  platform: string | null;
  arch: string | null;
  permissionSetHash: string | null;
  publisherIdentityKey: string | null;
  publisherDeviceLabel: string | null;
  parts: DevAppParts;
}

function artifactFromInstallation(installation: OrgDevAppInstallation): ResolvedOrgDevAppArtifact {
  return {
    url: `cozea-installed://${installation.activeRelease.contentHash}`,
    publicationId: installation.publicationId,
    organizationId: installation.organizationId,
    contentHash: installation.activeRelease.contentHash,
    entryPath: installation.activeRelease.entryPath,
    releaseId: installation.activeRelease.id,
    version: installation.activeRelease.version,
    runtimeKind: installation.activeRelease.runtimeKind,
    manifestVersion: installation.activeRelease.manifestVersion,
    platform: installation.activeRelease.platform,
    arch: installation.activeRelease.arch,
    permissionSetHash: installation.activeRelease.permissionSetHash,
    publisherIdentityKey: installation.activeRelease.publisherIdentityKey,
    publisherDeviceLabel: installation.activeRelease.publisherDeviceLabel,
    parts: installation.activeRelease.parts,
  };
}

interface WorkbenchOrgDevAppTileProps {
  projectId: string;
  laneId: string;
  tile: WorkbenchOrgDevAppTileRecord;
  workspaceId: string | null;
  workbenchSessionKey: string | null;
  panelApi: DockviewPanelApi;
  containerApi: DockviewApi;
}

export function WorkbenchOrgDevAppTile({
  projectId,
  laneId,
  tile,
  workspaceId,
  workbenchSessionKey,
  panelApi,
  containerApi,
}: WorkbenchOrgDevAppTileProps) {
  const { t } = useTranslation();
  const { convexUserId } = useAuth();
  const panelActivity = useWorkbenchPanelActivityMode(panelApi);
  const surfacePresentation = useDockviewBrowserSurfacePresentation(panelApi, containerApi);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [preparedOrigin, setPreparedOrigin] = useState<{
    releaseKey: string;
    url: string;
  } | null>(null);
  const [prepareAttempt, setPrepareAttempt] = useState(0);
  const [approvedReleaseKey, setApprovedReleaseKey] = useState<string | null>(null);
  const [approvalRequiredReleaseKey, setApprovalRequiredReleaseKey] = useState<string | null>(null);
  const [runtimeState, setRuntimeState] = useState<OrgDevAppRuntimeState | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [environmentStatus, setEnvironmentStatus] = useState<OrgDevAppEnvironmentStatus | null>(
    null,
  );
  const [environmentValues, setEnvironmentValues] = useState<Record<string, string>>({});
  const [showConfiguration, setShowConfiguration] = useState(false);
  const [servicePermissions, setServicePermissions] = useState<{
    network: boolean;
    persistentData: boolean;
  } | null>(null);
  const [workerApprovalRequired, setWorkerApprovalRequired] = useState(false);
  const [workerCapabilities, setWorkerCapabilities] = useState<DevAppCapability[]>([]);
  const [showFolderAccess, setShowFolderAccess] = useState(false);
  const [folderGrants, setFolderGrants] = useState<DevAppFolderGrant[]>([]);
  const [installedResolution, setInstalledResolution] = useState<
    | undefined
    | null
    | { artifact: ResolvedOrgDevAppArtifact; error: string | null }
  >(undefined);

  const remoteArtifact = useQuery(
    api.devApps.getArtifactUrl,
    convexUserId && tile.devAppRef
      ? { ref: tile.devAppRef }
      : "skip",
  );
  const artifact: ResolvedOrgDevAppArtifact | null | undefined =
    installedResolution === undefined
      ? undefined
      : installedResolution?.artifact ?? remoteArtifact;

  useEffect(() => {
    if (!tile.devAppRef) {
      setInstalledResolution(null);
      return;
    }
    let cancelled = false;
    setInstalledResolution(undefined);
    void window.electronAPI.orgDevApp.getInstallation({ ref: tile.devAppRef }).then(async (result) => {
      if (cancelled) return;
      if (!result.success || !result.installation) {
        setInstalledResolution(null);
        return;
      }
      const mapped = artifactFromInstallation(result.installation);
      const prepared = await window.electronAPI.orgDevApp.prepareInstalled({ ref: tile.devAppRef });
      if (cancelled) return;
      setInstalledResolution({
        artifact: mapped,
        error: prepared.success ? null : prepared.error,
      });
    }).catch((error) => {
      if (!cancelled) {
        setInstalledResolution(null);
        setPrepareError(error instanceof Error ? error.message : t("orgDevApp.open.failed"));
      }
    });
    return () => { cancelled = true; };
  }, [prepareAttempt, t, tile.devAppRef]);

  const releaseKey = artifact ? `${artifact.contentHash}:${artifact.runtimeKind}` : null;
  const originUrl = preparedOrigin?.releaseKey === releaseKey ? (preparedOrigin?.url ?? "") : "";
  const serviceApproved = releaseKey !== null && approvedReleaseKey === releaseKey;
  const serviceNeedsApproval = releaseKey !== null && approvalRequiredReleaseKey === releaseKey;
  const runtimeContentHash = artifact?.contentHash ?? "";
  const runtimeKind = artifact?.runtimeKind ?? null;

  useEffect(() => {
    setPreparedOrigin(null);
    setPrepareError(null);
    setApprovalRequiredReleaseKey(null);
    setRuntimeState(null);
    setEnvironmentStatus(null);
    setEnvironmentValues({});
    setShowConfiguration(false);
    setServicePermissions(null);
    setWorkerApprovalRequired(false);
    setWorkerCapabilities([]);
  }, [releaseKey]);

  useEffect(() => {
    if (!artifact?.parts.worker || !tile.devAppRef || !workspaceId) return;
    if (artifact.runtimeKind === "service" && !originUrl) return;
    let cancelled = false;
    void getDeviceSession()
      .then(async (session) => {
        const ensured = await window.electronAPI.orgDevApp.ensurePublishedRuntime({
          ref: tile.devAppRef!,
          workspaceId,
          laneId,
          leaseId: tile.id,
          gatewayBaseUrl: getDeviceGatewayBaseUrl(),
          accessToken: session.accessToken,
        });
        if (cancelled) return;
        if (!ensured.success) throw new Error(ensured.error);
        if (ensured.workerStatus === "approvalRequired") {
          setWorkerCapabilities(ensured.requestedCapabilities ?? []);
          setWorkerApprovalRequired(true);
        } else {
          setWorkerApprovalRequired(false);
        }
      })
      .catch((error) => {
        if (!cancelled) setPrepareError(error instanceof Error ? error.message : "The DevApp worker failed to start.");
      });
    return () => { cancelled = true; };
  }, [artifact, laneId, originUrl, prepareAttempt, tile.devAppRef, tile.id, workspaceId]);

  useEffect(() => {
    if (installedResolution?.error) {
      setPrepareError(installedResolution.error);
      return;
    }
    if (artifact === null) {
      setPreparedOrigin(null);
      setPrepareError(t("orgDevApp.open.accessLost"));
      return;
    }
    if (!artifact) return;
    const currentReleaseKey = `${artifact.contentHash}:${artifact.runtimeKind}`;
    let cancelled = false;
    setPrepareError(null);
    void window.electronAPI.orgDevApp
      .prepareArtifact({
        downloadUrl: artifact.url,
        contentHash: artifact.contentHash,
        entryPath: artifact.entryPath,
        runtimeKind: artifact.runtimeKind,
      })
      .then(async (result) => {
        if (cancelled) return;
        if (!result.success) {
          setPrepareError(result.error);
          return;
        }
        if (result.runtimeKind === "service") {
          setServicePermissions(result.servicePermissions ?? null);
          const permissionSetHash = artifact.permissionSetHash;
          if (!permissionSetHash)
            throw new Error("The Service DevApp permission metadata is missing.");
          const environment = await window.electronAPI.orgDevApp.getRuntimeEnvironment({
            contentHash: artifact.contentHash,
            publicationId: artifact.publicationId,
          });
          if (!environment.success) throw new Error(environment.error);
          setEnvironmentStatus(environment.status);
          if (environment.status.missingRequired.length > 0) {
            setShowConfiguration(true);
            return;
          }
          const trust = await window.electronAPI.orgDevApp.getRuntimeTrust({
            contentHash: artifact.contentHash,
            publicationId: artifact.publicationId,
            permissionSetHash,
          });
          if (!trust.success) throw new Error(trust.error);
          if (trust.trusted && !serviceApproved) setApprovedReleaseKey(currentReleaseKey);
          if (!trust.trusted && !serviceApproved) {
            setApprovalRequiredReleaseKey(currentReleaseKey);
            return;
          }
          setApprovalRequiredReleaseKey(null);
          if (!tile.devAppRef || !workspaceId) {
            throw new Error("The installed DevApp release is not attached to a workspace.");
          }
          const session = await getDeviceSession();
          const started = await window.electronAPI.orgDevApp.startRuntime({
            ref: tile.devAppRef,
            contentHash: artifact.contentHash,
            publicationId: artifact.publicationId,
            permissionSetHash,
            leaseId: tile.id,
            workspaceId,
            laneId,
            gatewayBaseUrl: getDeviceGatewayBaseUrl(),
            accessToken: session.accessToken,
          });
          if (!started.success) throw new Error(started.error);
          setRuntimeState(started.state);
          if (started.state.status !== "ready" || !started.state.originUrl) {
            throw new Error(started.state.error ?? "The Service DevApp did not start.");
          }
          if (!cancelled) {
            setPreparedOrigin({ releaseKey: currentReleaseKey, url: started.state.originUrl });
          }
          return;
        }
        setApprovalRequiredReleaseKey(null);
        setPreparedOrigin({ releaseKey: currentReleaseKey, url: result.originUrl });
      })
      .catch((error) => {
        if (cancelled) return;
        setPrepareError(error instanceof Error ? error.message : t("orgDevApp.open.failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, installedResolution, prepareAttempt, releaseKey, serviceApproved, t, tile.id]);

  useEffect(
    () => () => {
      if (runtimeKind !== "service") return;
      void window.electronAPI.orgDevApp.releaseRuntime({
        contentHash: runtimeContentHash,
        publicationId: artifact?.publicationId ?? "",
        leaseId: tile.id,
      });
    },
    [artifact?.publicationId, runtimeContentHash, runtimeKind, tile.id],
  );

  useEffect(() => {
    if (artifact?.runtimeKind !== "service" || !serviceApproved) return;
    let cancelled = false;
    const refresh = async () => {
      const result = await window.electronAPI.orgDevApp.getRuntimeState({
        contentHash: artifact.contentHash,
        publicationId: artifact.publicationId,
      });
      if (cancelled || !result.success) return;
      setRuntimeState(result.state);
      if (result.state.status === "failed") {
        setPreparedOrigin(null);
        setPrepareError(result.state.error ?? "The Service DevApp stopped unexpectedly.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), showLogs ? 1_000 : 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [artifact?.contentHash, artifact?.publicationId, artifact?.runtimeKind, serviceApproved, showLogs]);

  const runtimeGeneration = releaseKey
    ? `${releaseKey}:${artifact?.runtimeKind === "service" ? prepareAttempt : 0}`
    : null;
  const runtimeTabId = runtimeGeneration
    ? browserSurfaceRuntimeTabId({
        projectId,
        laneId,
        workspaceId,
        workbenchSessionKey,
        tileId: tile.id,
        kind: "orgDevApp",
        runtimeGeneration,
      })
    : null;
  const browserSurfaceDescriptor = useMemo<BrowserSurfaceDescriptor | null>(() => {
    if (!artifact || !originUrl || !runtimeTabId) return null;
    return {
      runtimeTabId,
      tileId: tile.id,
      workbenchSessionKey: resolveBrowserWorkbenchSessionKey({
        projectId,
        laneId,
        workspaceId,
        workbenchSessionKey,
      }),
      kind: "orgDevApp",
      title: tile.title || "DevApp",
      initialUrl: originUrl,
      storageScope: "orgDevApp",
      workspaceId,
      laneId,
      publicationId: artifact.publicationId,
      organizationId: artifact.organizationId,
      contentHash: artifact.contentHash,
      runtimeKind: artifact.runtimeKind,
      runtimeGeneration,
    };
  }, [
    artifact,
    laneId,
    originUrl,
    projectId,
    runtimeGeneration,
    runtimeTabId,
    tile.id,
    tile.title,
    workbenchSessionKey,
    workspaceId,
  ]);
  useHostedBrowserSurface(browserSurfaceDescriptor);
  const browserSurfaceState = useBrowserSurfaceStateStore((state) =>
    runtimeTabId ? state.byTabId[runtimeTabId] : undefined,
  );
  const browserPageError = resolveBrowserPageError(browserSurfaceState);
  const previewBridge = window.desktopBridge?.preview;
  const reloadEmbeddedDevApp = () => {
    if (!runtimeTabId || !previewBridge) return;
    void previewBridge.refresh(runtimeTabId).catch(() => undefined);
  };
  const refreshFolderGrants = async () => {
    if (!tile.devAppRef) return;
    const result = await window.electronAPI.orgDevApp.listFolderGrants({ ref: tile.devAppRef });
    if (!result.success) throw new Error(result.error);
    setFolderGrants(result.grants);
  };
  const restartAfterFolderChange = async () => {
    if (!artifact || !tile.devAppRef || !workspaceId) return;
    if (artifact.runtimeKind === "service") {
      await window.electronAPI.orgDevApp.stopRuntime({
        contentHash: artifact.contentHash,
        publicationId: artifact.publicationId,
      });
    } else {
      await window.electronAPI.orgDevApp.stopPublishedRuntime({
        ref: tile.devAppRef,
        workspaceId,
      });
    }
    setPreparedOrigin(null);
    setPrepareAttempt((attempt) => attempt + 1);
  };

  const statusMessage = useMemo(() => {
    if (!tile.devAppRef) return t("orgDevApp.open.referenceMissing");
    if (prepareError) return prepareError;
    if (serviceNeedsApproval)
      return "This Service DevApp runs trusted organization code on this Mac.";
    if (workerApprovalRequired)
      return "This DevApp includes code that can work with the current project.";
    if (!originUrl)
      return artifact?.runtimeKind === "service"
        ? "Starting Service DevApp…"
        : t("orgDevApp.open.preparing");
    return null;
  }, [artifact?.runtimeKind, originUrl, prepareError, serviceNeedsApproval, t, tile.devAppRef, workerApprovalRequired]);

  return (
    <WorkbenchTileChrome
      title={tile.title}
      panelApi={panelApi}
      containerApi={containerApi}
      chromeVariant="pill"
      tileType="orgDevApp"
      devAppId={artifact?.publicationId ?? tile.publicationId}
      logoDataUrl={tile.logoDataUrl}
      hideTitlePill={false}
      actions={
        artifact?.parts.runtime ? (
          <div className="flex items-center gap-1">
            {artifact.runtimeKind === "service" ? (
              <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setShowLogs((value) => !value)}
            >
              Logs
            </Button>
            {environmentStatus?.requirements.length ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => setShowConfiguration(true)}
              >
                Configure
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                void window.electronAPI.orgDevApp
                  .stopRuntime({
                    contentHash: artifact.contentHash,
                    publicationId: artifact.publicationId,
                  })
                  .then((result) => {
                    if (result.success) setRuntimeState(result.state);
                    setPreparedOrigin(null);
                  });
              }}
            >
              Stop
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                void window.electronAPI.orgDevApp
                  .stopRuntime({
                    contentHash: artifact.contentHash,
                    publicationId: artifact.publicationId,
                  })
                  .finally(() => {
                    setPreparedOrigin(null);
                    setPrepareAttempt((attempt) => attempt + 1);
                  });
              }}
            >
              Restart
            </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                void refreshFolderGrants()
                  .then(() => setShowFolderAccess(true))
                  .catch((error) => setPrepareError(error instanceof Error ? error.message : "Failed to inspect folder access."));
              }}
            >
              Files
            </Button>
          </div>
        ) : null
      }
      contentClassName="relative h-full overflow-hidden bg-content-surface"
    >
      {statusMessage ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p
            className={
              prepareError
                ? "max-w-md text-sm text-destructive"
                : "max-w-md text-sm text-muted-foreground"
            }
          >
            {statusMessage}
          </p>
          {prepareError && artifact !== null ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPrepareError(null);
                setPrepareAttempt((attempt) => attempt + 1);
              }}
            >
              {t("orgDevApp.open.retry")}
            </Button>
          ) : null}
          {serviceNeedsApproval ? (
            <div className="flex max-w-md flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Published by{" "}
                {artifact?.publisherDeviceLabel ??
                  artifact?.publisherIdentityKey ??
                  "an organization device"}
                . Node on macOS Apple silicon.
                {servicePermissions?.network
                  ? " Network access requested."
                  : " No network access requested."}
                {servicePermissions?.persistentData
                  ? " Persistent local data requested."
                  : " No persistent local data requested."}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!artifact?.permissionSetHash) return;
                  void window.electronAPI.orgDevApp
                    .approveRuntime({
                      contentHash: artifact.contentHash,
                      publicationId: artifact.publicationId,
                      permissionSetHash: artifact.permissionSetHash,
                    })
                    .then((result) => {
                      if (!result.success) {
                        setPrepareError(result.error);
                        return;
                      }
                      setApprovedReleaseKey(releaseKey);
                    });
                }}
              >
                Run trusted service
              </Button>
            </div>
          ) : null}
          {workerApprovalRequired && tile.devAppRef && workspaceId ? (
            <div className="flex max-w-md flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Requested access: {workerCapabilities.length > 0 ? workerCapabilities.join(", ") : "no host capabilities"}.
                You can run the worker for this project without granting autonomous agent use.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void window.electronAPI.orgDevApp.approvePublishedWorker({
                      ref: tile.devAppRef!,
                      workspaceId,
                      agentInvocable: false,
                    }).then((result) => {
                      if (!result.success) setPrepareError(result.error);
                      else setPrepareAttempt((attempt) => attempt + 1);
                    });
                  }}
                >
                  Run worker
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void window.electronAPI.orgDevApp.approvePublishedWorker({
                      ref: tile.devAppRef!,
                      workspaceId,
                      agentInvocable: true,
                    }).then((result) => {
                      if (!result.success) setPrepareError(result.error);
                      else setPrepareAttempt((attempt) => attempt + 1);
                    });
                  }}
                >
                  Run and allow agents
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="relative h-full min-h-0 overflow-hidden bg-content-surface">
          {runtimeTabId ? (
            <BrowserSurfaceSlot
              tabId={runtimeTabId}
              visible={panelActivity.visible && !browserPageError}
              borderRadius={surfacePresentation.borderRadius}
              stackingLayer={surfacePresentation.stackingLayer}
              subscribePositionChanges={surfacePresentation.subscribePositionChanges}
              className="absolute inset-0 size-full"
            />
          ) : null}
          {browserPageError ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-content-surface p-6 text-center">
              <div className="max-w-sm space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {browserPageError.kind === "transport"
                      ? "The DevApp surface could not be reached"
                      : `${browserPageError.diagnostic.statusCode} ${browserPageError.diagnostic.statusText || "HTTP error"}`}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {browserPageError.kind === "transport"
                      ? `${browserPageError.description} (${browserPageError.code}). The DevApp runtime remains independently manageable.`
                      : "The DevApp returned an empty error response. Its runtime state is unchanged."}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={reloadEmbeddedDevApp}>
                  Reload DevApp
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <Dialog open={showLogs} onOpenChange={setShowLogs}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Service logs</DialogTitle>
            <DialogDescription>Output from this DevApp's local service runtime.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-background p-3">
            <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground">
              {(runtimeState?.logs ?? []).join("\n") || "No service output yet."}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showFolderAccess} onOpenChange={setShowFolderAccess}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Local folder access</DialogTitle>
            <DialogDescription>
              This contained DevApp sees only folders you explicitly grant. Access is bound to this exact release and expires automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {folderGrants.length === 0 ? (
              <p className="text-xs text-muted-foreground">No local folders are mounted.</p>
            ) : folderGrants.map((grant) => (
              <div key={grant.grantId} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{grant.canonicalHostPath}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {grant.access === "readWrite" ? "Read and write" : "Read only"} · {grant.guestPath}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!tile.devAppRef) return;
                    void window.electronAPI.orgDevApp.revokeFolderGrant({
                      ref: tile.devAppRef,
                      grantId: grant.grantId,
                    }).then(async (result) => {
                      if (!result.success) throw new Error(result.error);
                      await refreshFolderGrants();
                      await restartAfterFolderChange();
                    }).catch((error) => setPrepareError(error instanceof Error ? error.message : "Failed to revoke folder access."));
                  }}
                >
                  Revoke
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {(["read", "readWrite"] as const).map((access) => (
                <Button
                  key={access}
                  type="button"
                  variant={access === "read" ? "outline" : "default"}
                  size="sm"
                  onClick={() => {
                    if (!tile.devAppRef) return;
                    void window.electronAPI.orgDevApp.grantFolder({ ref: tile.devAppRef, access })
                      .then(async (result) => {
                        if (!result.success) throw new Error(result.error);
                        if (!result.grant) return;
                        await refreshFolderGrants();
                        await restartAfterFolderChange();
                      })
                      .catch((error) => setPrepareError(error instanceof Error ? error.message : "Failed to grant folder access."));
                  }}
                >
                  {access === "read" ? "Grant read-only folder" : "Grant read-write folder"}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {showConfiguration && environmentStatus ? (
        <Dialog open onOpenChange={(open) => setShowConfiguration(open)}>
          <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Service configuration</DialogTitle>
              <DialogDescription>
                Values stay encrypted on this Mac and are passed only to the service process.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
            {environmentStatus.requirements.map((requirement) => (
              <label key={requirement.name} className="flex flex-col gap-1.5 text-xs">
                <span className="flex items-center gap-2">
                  <span className="font-mono">{requirement.name}</span>
                  {requirement.required ? (
                    <span className="text-destructive">Required</span>
                  ) : (
                    <span className="text-muted-foreground">Optional</span>
                  )}
                  {requirement.configured ? (
                    <span className="text-muted-foreground">Configured</span>
                  ) : null}
                </span>
                {requirement.description ? (
                  <span className="text-muted-foreground">{requirement.description}</span>
                ) : null}
                <Input
                  type={requirement.secret ? "password" : "text"}
                  autoComplete="off"
                  value={environmentValues[requirement.name] ?? ""}
                  placeholder={
                    requirement.configured ? "Leave blank to keep the saved value" : "Enter a value"
                  }
                  onChange={(event) =>
                    setEnvironmentValues((current) => ({
                      ...current,
                      [requirement.name]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
            <div className="flex justify-end gap-2">
              {environmentStatus.missingRequired.length === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowConfiguration(false)}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (!artifact) return;
                  const values = Object.fromEntries(
                    Object.entries(environmentValues).filter(([, value]) => value.length > 0),
                  );
                  void window.electronAPI.orgDevApp
                    .setRuntimeEnvironment({
                      contentHash: artifact.contentHash,
                      publicationId: artifact.publicationId,
                      values,
                    })
                    .then(async (result) => {
                      if (!result.success) {
                        setPrepareError(result.error);
                        return;
                      }
                      setEnvironmentValues({});
                      setEnvironmentStatus(result.status);
                      if (result.status.missingRequired.length > 0) return;
                      setShowConfiguration(false);
                      if (runtimeState?.status === "ready") {
                        await window.electronAPI.orgDevApp.stopRuntime({
                          contentHash: artifact.contentHash,
                          publicationId: artifact.publicationId,
                        });
                        setPreparedOrigin(null);
                      }
                      setPrepareAttempt((attempt) => attempt + 1);
                    });
                }}
              >
                Save and restart
              </Button>
            </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </WorkbenchTileChrome>
  );
}
