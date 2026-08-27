import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert01Icon as __AlertHugeIcon,
  ImageAdd01Icon as __ImageAddHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  optimizeProjectDevAppLogo,
  PROJECT_DEVAPP_LOGO_ACCEPT,
} from "@/features/devapps/projectDevAppLogo";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ProjectDevAppLogoDialogMode = "launch" | "update" | "change" | "publish";

const PROJECT_DEVAPP_NAME_MAX_LENGTH = 80;

interface ProjectDevAppLogoDialogBaseProps {
  open: boolean;
  projectName: string;
  initialLogoDataUrl?: string | null;
  saveErrorMessage?: string | null;
  onOpenChange: (open: boolean) => void;
}

interface ProjectDevAppLogoOnlyDialogProps extends ProjectDevAppLogoDialogBaseProps {
  mode: Exclude<ProjectDevAppLogoDialogMode, "change">;
  onConfirm: (logoDataUrl: string) => void | Promise<void>;
}

interface ProjectDevAppIdentityDialogProps extends ProjectDevAppLogoDialogBaseProps {
  mode: "change";
  initialName?: string;
  onConfirm: (logoDataUrl: string, normalizedName: string) => void | Promise<void>;
}

type ProjectDevAppLogoDialogProps =
  | ProjectDevAppLogoOnlyDialogProps
  | ProjectDevAppIdentityDialogProps;

export function ProjectDevAppLogoDialog(props: ProjectDevAppLogoDialogProps) {
  const {
    open,
    projectName,
    initialLogoDataUrl = null,
    saveErrorMessage = null,
    onOpenChange,
  } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectionIdRef = useRef(0);
  const initialName = props.mode === "change" ? (props.initialName ?? projectName) : projectName;
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(initialLogoDataUrl);
  const [devAppName, setDevAppName] = useState(initialName);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    selectionIdRef.current += 1;
    setLogoDataUrl(initialLogoDataUrl);
    setDevAppName(initialName);
    setFileName(null);
    setErrorMessage(null);
    setIsProcessing(false);
    setIsDragging(false);

    return () => {
      selectionIdRef.current += 1;
    };
  }, [initialLogoDataUrl, initialName, open]);

  const chooseFile = () => {
    inputRef.current?.click();
  };

  const processFile = async (file: File | null) => {
    if (!file) return;
    const selectionId = selectionIdRef.current + 1;
    selectionIdRef.current = selectionId;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const optimizedLogo = await optimizeProjectDevAppLogo(file);
      if (selectionIdRef.current !== selectionId) return;
      setLogoDataUrl(optimizedLogo);
      setFileName(file.name);
    } catch (error) {
      if (selectionIdRef.current !== selectionId) return;
      setErrorMessage(error instanceof Error ? error.message : t("projectDevApp.logo.error"));
    } finally {
      if (selectionIdRef.current === selectionId) {
        setIsProcessing(false);
      }
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    void processFile(event.dataTransfer.files[0] ?? null);
  };

  const handleUploadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    chooseFile();
  };

  const normalizedName = devAppName.trim();
  const normalizedInitialName = initialName.trim();
  const isNameValid =
    normalizedName.length > 0 && normalizedName.length <= PROJECT_DEVAPP_NAME_MAX_LENGTH;
  const hasIdentityChanged =
    normalizedName !== normalizedInitialName || logoDataUrl !== initialLogoDataUrl;
  const dialogSubjectName = normalizedInitialName || projectName;
  const previewName = normalizedName || dialogSubjectName;
  const projectTitle = t(
    props.mode === "change" ? "projectDevApp.logo.changeTitle" : "projectDevApp.logo.title",
  ).replace("{name}", dialogSubjectName);
  const description = t(
    props.mode === "change"
      ? "projectDevApp.logo.changeDescription"
      : "projectDevApp.logo.description",
  );
  const confirmLabel =
    props.mode === "change"
      ? t("projectDevApp.logo.saveAction")
      : props.mode === "update"
        ? t("projectDevApp.logo.updateAction")
        : t("projectDevApp.logo.launchAction");
  const visibleErrorMessage = errorMessage ?? saveErrorMessage;
  const isConfirmDisabled =
    !logoDataUrl ||
    isProcessing ||
    (props.mode === "change" && (!isNameValid || !hasIdentityChanged));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{projectTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept={PROJECT_DEVAPP_LOGO_ACCEPT}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void processFile(file);
          }}
        />

        {props.mode === "change" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="project-devapp-name" className="text-xs font-medium text-foreground">
                {t("projectDevApp.logo.nameLabel")}
              </Label>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {devAppName.length}/{PROJECT_DEVAPP_NAME_MAX_LENGTH}
              </span>
            </div>
            <Input
              id="project-devapp-name"
              value={devAppName}
              maxLength={PROJECT_DEVAPP_NAME_MAX_LENGTH}
              required
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="bg-muted/35 shadow-none dark:bg-input/40"
              onChange={(event) => {
                setDevAppName(event.currentTarget.value);
              }}
            />
          </div>
        ) : null}

        <div
          role="button"
          tabIndex={0}
          aria-label={t("projectDevApp.logo.choose")}
          aria-describedby="project-devapp-logo-formats"
          className={cn(
            "group flex cursor-pointer flex-col items-center gap-4 rounded-2xl border border-border/70 bg-muted/25 px-6 py-6 text-center outline-none transition-colors",
            "hover:border-foreground/20 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
            isDragging && "border-primary/50 bg-primary/5",
          )}
          onClick={chooseFile}
          onKeyDown={handleUploadKeyDown}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setIsDragging(false);
          }}
          onDrop={handleDrop}
        >
          <div className="flex size-28 items-center justify-center overflow-hidden rounded-[25px] border border-border/70 bg-background shadow-sm/5">
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt={t("projectDevApp.logo.previewAlt").replace("{name}", previewName)}
                className="h-full w-full object-cover"
              />
            ) : (
              <HugeiconsIcon
                icon={__ImageAddHugeIcon}
                className="size-8 text-muted-foreground transition-colors group-hover:text-foreground"
              />
            )}
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {isProcessing
                ? t("projectDevApp.logo.processing")
                : logoDataUrl
                  ? t("projectDevApp.logo.replace")
                  : t("projectDevApp.logo.choose")}
            </p>
            <p id="project-devapp-logo-formats" className="text-xs leading-5 text-muted-foreground">
              {fileName ?? t("projectDevApp.logo.formats")}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("projectDevApp.logo.scope")}</span>
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">
            {t("appStore.page.privateBadge")}
          </span>
        </div>

        {visibleErrorMessage ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            <HugeiconsIcon icon={__AlertHugeIcon} className="mt-0.5 size-4 shrink-0" />
            <p className="leading-5">{visibleErrorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={isConfirmDisabled}
            onClick={() => {
              if (!logoDataUrl) return;

              if (props.mode === "change") {
                if (!isNameValid || !hasIdentityChanged) return;
                void props.onConfirm(logoDataUrl, normalizedName);
                return;
              }

              void props.onConfirm(logoDataUrl);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
