import { useCallback, useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { HugeiconsIcon } from '@hugeicons/react'
import { InboxIcon as __InboxHugeIcon } from '@hugeicons/core-free-icons'

function getWorkspaceInitial(workspaceName: string | undefined | null): string {
  const source = (workspaceName ?? "?").trim();
  return source.charAt(0).toUpperCase() || "?";
}

function getUserDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null | undefined): string {
  const first = user?.firstName?.trim() ?? "";
  const last = user?.lastName?.trim() ?? "";
  const fullName = `${first} ${last}`.trim();
  return fullName || user?.email?.trim() || "Unknown owner";
}

export function HeaderInboxButton() {
  const { principalId, user } = useAuth();
  const acceptInvite = useMutation(api.projectInvites.acceptInvite);
  const declineInvite = useMutation(api.projectInvites.declineInvite);
  const incomingInvites = useQuery(
    api.projectInvites.listIncomingForUser,
    principalId ? { userId: principalId } : "skip",
  );
  const [activeInviteAction, setActiveInviteAction] = useState<{
    inviteId: Id<"projectInvites">;
    action: "accept" | "decline";
  } | null>(null);
  const [inviteActionError, setInviteActionError] = useState<string | null>(null);
  const inboxHeadingId = useId();
  const inviteCount = incomingInvites?.length ?? 0;
  const hasLocalDeviceProfile = Boolean(
    user?.email?.trim().toLowerCase().endsWith("@local.cozea.app"),
  );

  const formatRelativeTimestamp = useCallback((timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(diff / 604800000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    if (weeks < 52) return `${weeks}w`;
    return new Date(timestamp).toLocaleDateString();
  }, []);

  const handleInviteAction = useCallback(
    async (inviteId: Id<"projectInvites">, action: "accept" | "decline") => {
      if (action === "accept" && !principalId) return;
      setInviteActionError(null);
      setActiveInviteAction({ inviteId, action });

      try {
        if (action === "accept") {
          const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity();
          await acceptInvite({
            inviteId,
            userId: principalId!,
            deviceId: deviceIdentity.deviceId,
            deviceLabel: deviceIdentity.deviceLabel,
            platform: deviceIdentity.platform,
            fingerprint: deviceIdentity.fingerprint,
          });
        } else {
          await declineInvite({ inviteId });
        }
      } catch (error) {
        setInviteActionError(
          error instanceof Error ? error.message : "Unable to process invite action.",
        );
      } finally {
        setActiveInviteAction(null);
      }
    },
    [acceptInvite, principalId, declineInvite],
  );

  if (hasLocalDeviceProfile) {
    return null;
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="h-7 sm:h-7 gap-1 shrink-0 rounded-md bg-transparent px-3 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground"
            >
              <span className="relative flex">
                <HugeiconsIcon icon={__InboxHugeIcon} className="size-3 shrink-0" />
                {inviteCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
              </span>
              <span className="text-[10px] leading-none">Inbox</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Inbox</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 rounded-lg p-0 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_0_20px_rgba(0,0,0,0.06)]">
        <div id={inboxHeadingId} className="px-3 py-2 text-xs font-semibold">
          Inbox
        </div>
        <div className="h-px bg-border/60" />
        <div className="max-h-[30rem] overflow-y-auto" aria-labelledby={inboxHeadingId}>
          {incomingInvites === undefined ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Loading...</div>
          ) : inviteCount > 0 ? (
            <div className="space-y-px p-1" role="list">
              {incomingInvites!.slice(0, 8).map((invite) => {
                const isAccepting =
                  activeInviteAction?.inviteId === invite._id &&
                  activeInviteAction.action === "accept";
                const isDeclining =
                  activeInviteAction?.inviteId === invite._id &&
                  activeInviteAction.action === "decline";
                const isBusy = isAccepting || isDeclining;

                return (
                  <div
                    key={String(invite._id)}
                    role="listitem"
                    className="rounded px-2 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="mt-0.5 h-8 w-8 shrink-0 rounded-full">
                        <AvatarImage
                          src={invite.ownerUser?.profileImageUrl ?? undefined}
                          alt={getUserDisplayName(invite.ownerUser)}
                        />
                        <AvatarFallback className="text-xs font-normal">
                          {getWorkspaceInitial(getUserDisplayName(invite.ownerUser))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-normal leading-5 text-foreground">
                          {invite.project?.name ?? "Unknown Project"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {getUserDisplayName(invite.ownerUser)} &middot;{" "}
                          {formatRelativeTimestamp(invite.invitedAt)}
                        </p>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 rounded px-2.5 text-[11px] transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            disabled={isBusy || activeInviteAction !== null}
                            onClick={() => {
                              void handleInviteAction(invite._id, "decline");
                            }}
                          >
                            {isDeclining ? "Declining..." : "Decline"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 rounded px-2.5 text-[11px]"
                            disabled={isBusy || activeInviteAction !== null}
                            onClick={() => {
                              void handleInviteAction(invite._id, "accept");
                            }}
                          >
                            {isAccepting ? "Accepting..." : "Accept"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {inviteActionError ? (
                <p className="px-2 py-1.5 text-xs text-destructive" role="status">
                  {inviteActionError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
              <HugeiconsIcon icon={__InboxHugeIcon} className="h-5 w-5 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">All caught up</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
