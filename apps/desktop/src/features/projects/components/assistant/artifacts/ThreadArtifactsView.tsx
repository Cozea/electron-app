import { useEffect, useMemo, useState } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownZeroOneIcon as __DownloadHugeIcon,
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  CheckmarkCircle02Icon as __CheckHugeIcon,
  CopyIcon as __CopyHugeIcon,
  Image01Icon as __ImageHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ThreadImageArtifact } from "./threadArtifacts";
import type { ThreadArtifactMediaState } from "./useThreadArtifactMedia";

interface ThreadArtifactsViewProps {
  artifacts: ReadonlyArray<ThreadImageArtifact>;
  media: ThreadArtifactMediaState;
  selectedArtifactId?: string | null;
  onSelectedArtifactChange?: (artifactId: string | null) => void;
}

function artifactFileName(artifact: ThreadImageArtifact): string {
  const extension =
    artifact.mimeType === "image/jpeg"
      ? "jpg"
      : artifact.mimeType === "image/webp"
        ? "webp"
        : artifact.mimeType === "image/gif"
          ? "gif"
          : "png";
  const stem = artifact.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `${stem || "generated-image"}.${extension}`;
}

async function copyArtifactImage(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the generated image");
  const blob = await response.blob();
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Image copy is unavailable on this system");
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
}

async function downloadArtifactImage(url: string, artifact: ThreadImageArtifact): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the generated image");
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = artifactFileName(artifact);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function ArtifactPreview(props: {
  artifact: ThreadImageArtifact;
  media: ThreadArtifactMediaState;
  className?: string;
}) {
  const url = props.media.urlsById[props.artifact.id];
  const loading = props.media.loadingIds.has(props.artifact.id);
  const failed = props.media.errorIds.has(props.artifact.id);

  if (url) {
    return (
      <img
        src={url}
        alt={props.artifact.title}
        className={cn("h-full w-full object-contain", props.className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 bg-secondary/35 text-muted-foreground",
        (loading || props.artifact.status === "inProgress") &&
          "animate-pulse motion-reduce:animate-none",
        props.className,
      )}
    >
      <HugeiconsIcon icon={__ImageHugeIcon} className="size-6" aria-hidden="true" />
      <span className="px-3 text-center text-[11px]">
        {failed
          ? "Preview unavailable"
          : props.artifact.status === "inProgress"
            ? "Generating image…"
            : loading
              ? "Loading preview…"
              : "Image unavailable"}
      </span>
    </div>
  );
}

export function ThreadArtifactsView({
  artifacts,
  media,
  selectedArtifactId,
  onSelectedArtifactChange,
}: ThreadArtifactsViewProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedId = selectedArtifactId === undefined ? internalSelectedId : selectedArtifactId;
  const selectArtifact = onSelectedArtifactChange ?? setInternalSelectedId;
  const orderedArtifacts = useMemo(() => [...artifacts].reverse(), [artifacts]);
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !artifacts.some((artifact) => artifact.id === selectedId)) {
      selectArtifact(null);
    }
  }, [artifacts, selectArtifact, selectedId]);

  if (selectedArtifact) {
    const url = media.urlsById[selectedArtifact.id];
    return (
      <section
        className="flex h-full min-h-0 flex-col bg-content-surface"
        aria-label="Artifact detail"
      >
        <div className="flex min-h-11 items-center gap-2 border-b border-border/60 px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => selectArtifact(null)}
            aria-label="Back to artifacts"
          >
            <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{selectedArtifact.title}</p>
            {selectedArtifact.status === "inProgress" ? (
              <p className="text-[10px] text-muted-foreground">Generating</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={!url}
            onClick={() => {
              if (!url) return;
              setActionError(null);
              void copyArtifactImage(url)
                .then(() => {
                  setCopiedId(selectedArtifact.id);
                  window.setTimeout(() => setCopiedId(null), 1_500);
                })
                .catch((error: unknown) => {
                  setActionError(
                    error instanceof Error ? error.message : "Could not copy the image",
                  );
                });
            }}
          >
            <HugeiconsIcon
              icon={copiedId === selectedArtifact.id ? __CheckHugeIcon : __CopyHugeIcon}
              className="size-3.5"
            />
            {copiedId === selectedArtifact.id ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-[11px]"
            disabled={!url}
            onClick={() => {
              if (!url) return;
              setActionError(null);
              void downloadArtifactImage(url, selectedArtifact).catch((error: unknown) => {
                setActionError(error instanceof Error ? error.message : "Could not save the image");
              });
            }}
          >
            <HugeiconsIcon icon={__DownloadHugeIcon} className="size-3.5" />
            Save
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {actionError ? (
            <p role="status" className="mx-auto mb-3 max-w-3xl text-xs text-destructive">
              {actionError}
            </p>
          ) : null}
          <div className="mx-auto flex min-h-full max-w-5xl items-center justify-center overflow-hidden rounded-lg bg-secondary/25">
            <ArtifactPreview artifact={selectedArtifact} media={media} />
          </div>
          {selectedArtifact.prompt ? (
            <p className="mx-auto mt-4 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {selectedArtifact.prompt}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className="h-full min-h-0 overflow-y-auto bg-content-surface p-3"
      aria-label="Thread artifacts"
    >
      {orderedArtifacts.length === 0 ? (
        <div className="flex h-full min-h-52 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <HugeiconsIcon icon={__ImageHugeIcon} className="size-7 opacity-70" aria-hidden="true" />
          <p className="text-xs font-medium text-foreground/80">No generated images yet</p>
          <p className="max-w-64 text-[11px] leading-relaxed">
            Images generated in this chat will collect here while the conversation keeps running.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {orderedArtifacts.map((artifact) => {
            const hasPreview = Boolean(media.urlsById[artifact.id]);
            return (
              <button
                key={artifact.id}
                type="button"
                className="group min-w-0 text-left focus-visible:outline-none [&:focus-visible_img]:ring-2 [&:focus-visible_img]:ring-ring"
                onClick={() => selectArtifact(artifact.id)}
              >
                <div
                  className={cn(
                    !hasPreview && "aspect-[4/3] overflow-hidden bg-secondary/25",
                  )}
                >
                  <ArtifactPreview
                    artifact={artifact}
                    media={media}
                    className={cn(
                      "transition-all duration-200 motion-reduce:transform-none",
                      hasPreview &&
                        "h-auto w-full shadow-md shadow-black/20 group-hover:scale-[1.015] group-hover:shadow-lg group-hover:shadow-black/25",
                    )}
                  />
                </div>
                <div className="min-w-0 px-0.5 pt-2">
                  <p className="truncate text-[11px] font-medium" title={artifact.title}>
                    {artifact.title}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
