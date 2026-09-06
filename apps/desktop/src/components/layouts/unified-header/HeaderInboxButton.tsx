import { useCallback, useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { HugeiconsIcon } from '@hugeicons/react'
import { InboxIcon as __InboxHugeIcon } from '@hugeicons/core-free-icons'

function initial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function cleanConvexError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Could not update this invitation."
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "")
}

export function HeaderInboxButton() {
  const { principalId } = useAuth();
  const incoming = useQuery(
    api.projectDeviceEnrollments.listIncoming,
    principalId ? {} : "skip",
  );
  const resolveEnrollment = useMutation(api.projectDeviceEnrollments.resolve);
  const [activeAction, setActiveAction] = useState<{
    enrollmentId: Id<"projectDeviceEnrollments">;
    accept: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const count = incoming?.length ?? 0;

  const resolve = useCallback(async (
    enrollmentId: Id<"projectDeviceEnrollments">,
    accept: boolean,
  ) => {
    setError(null);
    setActiveAction({ enrollmentId, accept });
    try {
      await resolveEnrollment({ enrollmentId, accept });
    } catch (caught) {
      setError(cleanConvexError(caught));
    } finally {
      setActiveAction(null);
    }
  }, [resolveEnrollment]);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7"
              aria-label={count > 0 ? `Invitations (${count})` : "Invitations"}
            >
              <HugeiconsIcon icon={__InboxHugeIcon} className="size-4" />
              {count > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium leading-3.5 text-primary-foreground">
                  {count > 9 ? "9+" : count}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Invitations</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border/60 px-3 py-2.5">
          <p id={headingId} className="text-xs font-medium">Device invitations</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Projects requesting access for this device.
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto p-2" aria-labelledby={headingId}>
          {error ? <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{error}</p> : null}
          {incoming === undefined ? (
            <p className="px-2 py-5 text-center text-xs text-muted-foreground">Loading…</p>
          ) : incoming.length === 0 ? (
            <p className="px-2 py-5 text-center text-xs text-muted-foreground">No pending invitations.</p>
          ) : (
            <div className="space-y-1.5">
              {incoming.map((enrollment) => {
                const busy = activeAction?.enrollmentId === enrollment._id;
                return (
                  <div key={enrollment._id} className="rounded-lg border border-border/60 p-2.5">
                    <div className="flex items-start gap-2.5">
                      <Avatar className="size-8 shrink-0 rounded-lg">
                        <AvatarFallback className="rounded-lg text-[10px]">
                          {initial(enrollment.projectName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{enrollment.projectName}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          Invited by {enrollment.inviterName} · {enrollment.role.replace(/_/g, " ")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() => void resolve(enrollment._id, false)}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() => void resolve(enrollment._id, true)}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
