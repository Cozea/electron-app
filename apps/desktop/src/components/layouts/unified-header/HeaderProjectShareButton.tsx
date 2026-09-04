import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { scheduleTask } from "@/lib/scheduler";
import { buildProjectJoinUrl } from "@shared/projectShare";
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext";
import { useQueryCache } from "@/stores/useQueryCache";
import { getPersonalProjectContactsCacheKey } from "@/lib/queryCacheKeys";
import { isLocalDeviceEmail } from "@/lib/userDisplay";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {

  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc";
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient";
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  cleanConvexError,
  formatInviteeDisplayName,
  getInitials,
  getLinkPermissionDescription,
  PERSONAL_CONTACTS_CACHE_MAX_AGE_MS,
  type PersonalProjectContact,
  type ProjectInviteRole,
  PROJECT_INVITE_ROLE_OPTIONS,
} from "./headerShared";

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon as __PlusHugeIcon, AddTeamIcon as __AddTeamHugeIcon, MoreVerticalIcon as __MoreVerticalHugeIcon, ChevronDoubleCloseIcon as __ChevronDownHugeIcon, Delete02Icon as __Trash2HugeIcon, DocumentAttachmentIcon as __CopyHugeIcon, Link01Icon as __Link2HugeIcon, Refresh01Icon as __RefreshCwHugeIcon, SentIcon as __SendHugeIcon, Shield01Icon as __ShieldOffHugeIcon } from '@hugeicons/core-free-icons'

import { useTranslation } from "@/lib/i18n"

export function HeaderProjectShareButton({
  projectId,
  projectName,
}: {
  projectId: Id<"projects"> | null;
  projectName?: string | null;
}) {
  const { t } = useTranslation();
  const { convexUserId } = useAuth();
  const convex = useConvex();
  const syncContext = useOptionalProjectSyncContext();
  const inviteMember = useMutation(api.projectInvites.inviteMember);
  const cancelProjectInvite = useMutation(api.projectInvites.cancelInvite);
  const createOrUpdateActiveLink = useMutation(api.projectJoinLinks.createOrUpdateActiveLink);
  const removeProjectMember = useMutation(api.projectMembers.removeMember);
  const resendProjectInvite = useMutation(api.projectInvites.resendInvite);
  const rotateJoinLink = useMutation(api.projectJoinLinks.rotateLink);
  const revokeJoinLink = useMutation(api.projectJoinLinks.revokeLink);
  const updateProjectMemberRole = useMutation(api.projectMembers.updateRole);
  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    projectId && convexUserId ? { projectId, userId: convexUserId } : "skip",
  );
  const projectMembers = useQuery(
    api.projectMembers.listMembers,
    projectId && convexUserId ? { projectId, viewerUserId: convexUserId } : "skip",
  );
  const joinLinkState = useQuery(
    api.projectJoinLinks.getForProject,
    projectId && convexUserId ? { projectId, userId: convexUserId } : "skip",
  );
  const pendingProjectInvites = useQuery(
    api.projectInvites.listForProject,
    projectId && convexUserId ? { projectId, viewerUserId: convexUserId } : "skip",
  );
  const project = useQuery(
    api.projects.getAccessibleById,
    projectId && convexUserId
      ? {
          projectId,
        }
      : "skip",
  );
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [inviteMembers, setInviteMembers] = useState<
    Array<{ email: string; role: ProjectInviteRole }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [joinLinkRole, setJoinLinkRole] = useState<ProjectInviteRole>("developer");
  const [joinLinkError, setJoinLinkError] = useState<string | null>(null);
  const [joinLinkNotice, setJoinLinkNotice] = useState<string | null>(null);
  const [joinLinkAction, setJoinLinkAction] = useState<"copy" | "rotate" | "disable" | null>(null);
  const [isLoadingPersonalContacts, setIsLoadingPersonalContacts] = useState(false);
  const [personalContactsError, setPersonalContactsError] = useState<string | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamActionKey, setTeamActionKey] = useState<string | null>(null);
  const inviteEmailCandidates = useMemo(
    () =>
      Array.from(
        new Set(
          inviteMembers
            .map((member) => member.email.trim().toLowerCase())
            .filter((email) => email.length > 0),
        ),
      ),
    [inviteMembers],
  );
  const inviteLookup = useQuery(
    api.users.getByEmails,
    inviteEmailCandidates.length > 0 ? { emails: inviteEmailCandidates } : "skip",
  );
  const personalContactsCacheKey = getPersonalProjectContactsCacheKey(convexUserId, projectId);
  const personalContacts = useQueryCache((state) => {
    const entry = state.cache[personalContactsCacheKey];
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > PERSONAL_CONTACTS_CACHE_MAX_AGE_MS) {
      return undefined;
    }
    return entry.data as PersonalProjectContact[];
  });
  const inviteLookupByEmail = useMemo(() => {
    const next = new Map<string, NonNullable<typeof inviteLookup>[number]["user"]>();
    for (const entry of inviteLookup ?? []) {
      next.set(entry.email, entry.user);
    }
    return next;
  }, [inviteLookup]);
  const roleCheckPending = Boolean(projectId && convexUserId && memberRole === undefined);
  const shareStatePending = Boolean(projectId && convexUserId && joinLinkState === undefined);
  const canInvite = Boolean(projectId && convexUserId && memberRole === "project_manager");
  const activeJoinLink = joinLinkState?.activeLink ?? null;
  const canSendProjectInvites = canInvite;
  const canManageJoinLinks = canInvite;
  const canManagePersonalProjectAccess = canInvite;
  const projectMembersByEmail = useMemo(() => {
    const next = new Map<string, NonNullable<typeof projectMembers>[number]>();
    for (const member of projectMembers ?? []) {
      const email = (
        member.contactEmail ??
        (member.user?.email && !isLocalDeviceEmail(member.user.email) ? member.user.email : null)
      )?.trim().toLowerCase();
      if (!email) continue;
      next.set(email, member);
    }
    return next;
  }, [projectMembers]);
  const pendingInvitesByEmail = useMemo(() => {
    const next = new Map<string, NonNullable<typeof pendingProjectInvites>[number]>();
    for (const invite of pendingProjectInvites ?? []) {
      const email = invite.email?.trim().toLowerCase();
      if (!email) continue;
      next.set(email, invite);
    }
    return next;
  }, [pendingProjectInvites]);
  const unavailableContactEmails = useMemo(() => {
    const emails = new Set<string>();
    inviteMembers.forEach((member) => {
      emails.add(member.email.trim().toLowerCase());
    });
    return emails;
  }, [inviteMembers]);
  const filteredPersonalContacts = useMemo(() => {
    const search = emailInput.trim().toLowerCase();
    return (personalContacts ?? [])
      .filter((contact) => !unavailableContactEmails.has(contact.email.trim().toLowerCase()))
      .filter((contact) => {
        if (!search) return true;
        const displayName = formatInviteeDisplayName(contact.email, contact.user);
        return (
          contact.email.toLowerCase().includes(search) || displayName.toLowerCase().includes(search)
        );
      });
  }, [emailInput, personalContacts, unavailableContactEmails]);

  useEffect(() => {
    if (!isInviteOpen || !convexUserId || !projectId) return;

    let cancelled = false;
    const queryCache = useQueryCache.getState();
    const hasCachedContacts =
      queryCache.get<PersonalProjectContact[]>(
        personalContactsCacheKey,
        PERSONAL_CONTACTS_CACHE_MAX_AGE_MS,
      ) !== undefined;

    setPersonalContactsError(null);
    setIsLoadingPersonalContacts(!hasCachedContacts);

    void scheduleTask(async () => {
      try {
        const contacts = await convex.query(api.projectInvites.listPersonalContactsForUser, {
          userId: convexUserId,
          projectId,
        });
        if (cancelled) return;
        useQueryCache.getState().set(personalContactsCacheKey, contacts ?? []);
        setPersonalContactsError(null);
      } catch (error) {
        if (cancelled) return;
        setPersonalContactsError(cleanConvexError(error, "Failed to load contacts"));
      } finally {
        if (!cancelled) {
          setIsLoadingPersonalContacts(false);
        }
      }
    }, "background");

    return () => {
      cancelled = true;
    };
  }, [convex, convexUserId, isInviteOpen, personalContactsCacheKey, projectId]);

  const prewarmPersonalContacts = useCallback(() => {
    if (!convexUserId || !projectId) return;

    const queryCache = useQueryCache.getState();
    if (
      queryCache.get<PersonalProjectContact[]>(
        personalContactsCacheKey,
        PERSONAL_CONTACTS_CACHE_MAX_AGE_MS,
      ) !== undefined
    ) {
      return;
    }

    void scheduleTask(async () => {
      try {
        const contacts = await convex.query(api.projectInvites.listPersonalContactsForUser, {
          userId: convexUserId,
          projectId,
        });
        if (contacts !== undefined) {
          useQueryCache.getState().set(personalContactsCacheKey, contacts);
        }
      } catch {
        // Ignore prewarm failures and let the live modal query resolve normally.
      }
    }, "background");
  }, [convex, convexUserId, personalContactsCacheKey, projectId]);

  const flushProjectBeforeShare = useCallback(async () => {
    if (!syncContext?.collaborationEnabled) return;
    await syncContext.triggerSync();
  }, [syncContext]);

  useEffect(() => {
    if (!isInviteOpen || !activeJoinLink) return;
    setJoinLinkRole(activeJoinLink.role);
  }, [activeJoinLink, isInviteOpen]);

  const handleProjectMemberRoleChange = useCallback(
    async (memberUserId: Id<"users">, nextRole: ProjectInviteRole) => {
      if (!projectId || !project || !convexUserId || !canManagePersonalProjectAccess) return;
      const actionKey = `role:${String(memberUserId)}`;
      setTeamActionKey(actionKey);
      setTeamError(null);
      try {
        await updateProjectMemberRole({
          projectId,
          actorUserId: convexUserId,
          memberUserId,
          newRole: nextRole,
        });
      } catch (error) {
        setTeamError(cleanConvexError(error, "Failed to update member role"));
      } finally {
        setTeamActionKey(null);
      }
    },
    [canManagePersonalProjectAccess, convexUserId, project, projectId, updateProjectMemberRole],
  );

  const handleProjectMemberRemove = useCallback(
    async (memberUserId: Id<"users">) => {
      if (!projectId || !project || !convexUserId || !canManagePersonalProjectAccess) return;
      const actionKey = `remove:${String(memberUserId)}`;
      setTeamActionKey(actionKey);
      setTeamError(null);
      try {
        await removeProjectMember({
          projectId,
          actorUserId: convexUserId,
          memberUserId,
        });
      } catch (error) {
        setTeamError(cleanConvexError(error, "Failed to remove member"));
      } finally {
        setTeamActionKey(null);
      }
    },
    [
      canManagePersonalProjectAccess,
      convexUserId,
      project,
      projectId,
      removeProjectMember,
    ],
  );

  const handleProjectInviteResend = useCallback(
    async (inviteId: Id<"projectInvites">) => {
      if (!project || !convexUserId || !canManagePersonalProjectAccess) return;
      const actionKey = `resend:${String(inviteId)}`;
      setTeamActionKey(actionKey);
      setTeamError(null);
      try {
        await resendProjectInvite({ inviteId, actorUserId: convexUserId });
      } catch (error) {
        setTeamError(cleanConvexError(error, "Failed to resend invite"));
      } finally {
        setTeamActionKey(null);
      }
    },
    [canManagePersonalProjectAccess, convexUserId, project, resendProjectInvite],
  );

  const handleProjectInviteCancel = useCallback(
    async (inviteId: Id<"projectInvites">) => {
      if (!project || !convexUserId || !canManagePersonalProjectAccess) return;
      const actionKey = `cancel:${String(inviteId)}`;
      setTeamActionKey(actionKey);
      setTeamError(null);
      try {
        await cancelProjectInvite({ inviteId, actorUserId: convexUserId });
      } catch (error) {
        setTeamError(cleanConvexError(error, "Failed to cancel invite"));
      } finally {
        setTeamActionKey(null);
      }
    },
    [
      cancelProjectInvite,
      canManagePersonalProjectAccess,
      convexUserId,
      project,
    ],
  );

  const queueInviteEmail = useCallback((rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email) return;
    if (!email.includes("@")) {
      setInviteError(`Invalid email: ${rawEmail.trim()}`);
      return;
    }

    setInviteMembers((current) => {
      if (current.some((member) => member.email === email)) return current;
      return [...current, { email, role: "developer" }];
    });
  }, []);

  const handleAddEmail = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" && event.key !== ",") return;
      event.preventDefault();
      const segments = emailInput
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (!segments.length) return;

      setInviteError(null);
      segments.forEach((segment) => queueInviteEmail(segment));
      setEmailInput("");
    },
    [emailInput, queueInviteEmail],
  );

  const handleRemoveFromInviteList = useCallback((index: number) => {
    setInviteMembers((current) => current.filter((_, i) => i !== index));
  }, []);

  const handleUpdateRole = useCallback((index: number, role: ProjectInviteRole) => {
    setInviteMembers((current) =>
      current.map((member, i) => (i === index ? { ...member, role } : member)),
    );
  }, []);

  const handleInviteOpenChange = useCallback((open: boolean) => {
    setIsInviteOpen(open);
    if (!open) {
      setEmailInput("");
      setInviteMembers([]);
      setInviteError(null);
      setInviteNotice(null);
      setIsSubmitting(false);
      setIsLoadingPersonalContacts(false);
      setPersonalContactsError(null);
      setTeamError(null);
      setTeamActionKey(null);
      setJoinLinkError(null);
      setJoinLinkNotice(null);
      setJoinLinkAction(null);
    }
  }, []);

  const handleSendInvites = useCallback(async () => {
    if (!projectId || !convexUserId || !canSendProjectInvites || inviteMembers.length === 0) return;

    setIsSubmitting(true);
    setInviteError(null);
    setInviteNotice(null);

    try {
      await flushProjectBeforeShare();
      const failed: Array<{ email: string; error: string }> = [];
      let deliveryNotConfiguredCount = 0;

      for (const member of inviteMembers) {
        try {
          const result = await inviteMember({
            projectId,
            email: member.email,
            role: member.role,
            invitedBy: convexUserId,
          });
          if (result.emailDelivery === "not_configured") {
            deliveryNotConfiguredCount += 1;
          }
        } catch (error) {
          failed.push({
            email: member.email,
            error: cleanConvexError(error, "Failed to send invite"),
          });
        }
      }

      if (failed.length === 0) {
        if (deliveryNotConfiguredCount > 0) {
          setInviteMembers([]);
          setEmailInput("");
          setInviteNotice(
            deliveryNotConfiguredCount === inviteMembers.length
              ? "Invites were created, but no Resend integration is connected for this project yet, so no email was sent."
              : "Some invites were created without email delivery because no Resend integration is connected for this project yet.",
          );
          return;
        }
        handleInviteOpenChange(false);
        return;
      }

      const failedSet = new Set(failed.map((entry) => entry.email));
      setInviteMembers((current) => current.filter((member) => failedSet.has(member.email)));
      setInviteError(failed.map((entry) => `${entry.email}: ${entry.error}`).join(" | "));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSendProjectInvites,
    convexUserId,
    flushProjectBeforeShare,
    handleInviteOpenChange,
    inviteMember,
    inviteMembers,
    projectId,
  ]);

  const handleCopyJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return;
    setJoinLinkAction("copy");
    setJoinLinkError(null);
    setJoinLinkNotice(null);

    try {
      await flushProjectBeforeShare();
      const link = await createOrUpdateActiveLink({
        projectId,
        actorUserId: convexUserId,
        role: joinLinkRole,
      });
      const shareUrl = buildProjectJoinUrl(
        import.meta.env.VITE_SITE_URL as string | undefined,
        link.token,
      );
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is not available");
      }
      await navigator.clipboard.writeText(shareUrl);
      setJoinLinkNotice("Invite link copied to clipboard.");
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to copy invite link"));
    } finally {
      setJoinLinkAction(null);
    }
  }, [
    canManageJoinLinks,
    convexUserId,
    createOrUpdateActiveLink,
    flushProjectBeforeShare,
    joinLinkRole,
    projectId,
  ]);

  const handleRotateJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return;
    setJoinLinkAction("rotate");
    setJoinLinkError(null);
    setJoinLinkNotice(null);

    try {
      await rotateJoinLink({
        projectId,
        actorUserId: convexUserId,
        role: joinLinkRole,
      });
      setJoinLinkNotice("Invite link rotated.");
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to rotate invite link"));
    } finally {
      setJoinLinkAction(null);
    }
  }, [canManageJoinLinks, convexUserId, joinLinkRole, projectId, rotateJoinLink]);

  const handleDisableJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return;
    setJoinLinkAction("disable");
    setJoinLinkError(null);
    setJoinLinkNotice(null);

    try {
      await revokeJoinLink({
        projectId,
        actorUserId: convexUserId,
      });
      setJoinLinkNotice("Invite link disabled.");
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to disable invite link"));
    } finally {
      setJoinLinkAction(null);
    }
  }, [canManageJoinLinks, convexUserId, projectId, revokeJoinLink]);

  return (
    <Dialog open={isInviteOpen} onOpenChange={handleInviteOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              className="inline-flex h-7 w-7 sm:h-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground"
              disabled={!projectId || roleCheckPending || shareStatePending}
              aria-label={t("header.shareProject")}
              title={t("header.shareProject")}
              onMouseEnter={prewarmPersonalContacts}
              onFocus={prewarmPersonalContacts}
              onPointerDown={prewarmPersonalContacts}
            >
              {roleCheckPending || shareStatePending ? (
                <div className="loader text-muted-foreground" />
              ) : (
                <HugeiconsIcon icon={__AddTeamHugeIcon} className="size-4 shrink-0" />
              )}
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("header.shareProject")}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("header.shareProject")}</DialogTitle>
          <DialogDescription>
            {t("share.inviteCollaborators")}
            <span className="font-normal text-foreground">{projectName ?? t("share.thisProject")}</span>.
          </DialogDescription>
        </DialogHeader>

        {!canInvite ? (
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            Only project managers can invite collaborators.
          </div>
        ) : shareStatePending ? (
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            Loading project sharing settings…
          </div>
        ) : (
          <>
            {joinLinkError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {joinLinkError}
              </div>
            ) : null}
            {inviteError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {inviteError}
              </div>
            ) : null}
            {inviteNotice ? (
              <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {inviteNotice}
              </div>
            ) : null}
            {teamError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {teamError}
              </div>
            ) : null}
            {joinLinkNotice ? (
              <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {joinLinkNotice}
              </div>
            ) : null}

            <>
              <Input
                type="email"
                placeholder={t("share.enterEmails")}
                  value={emailInput}
                  onChange={(event) => {
                    setEmailInput(event.target.value);
                  }}
                  onKeyDown={handleAddEmail}
                  disabled={isSubmitting}
                />

                {personalContactsError ? (
                  <div className="px-1 py-2 text-sm text-muted-foreground">
                    Unable to load contacts right now.
                  </div>
                ) : isLoadingPersonalContacts && personalContacts === undefined ? (
                  <div className="px-1 py-2 text-sm text-muted-foreground">Loading contacts…</div>
                ) : filteredPersonalContacts.length > 0 ? (
                  <div className="app-scrollbar max-h-[18rem] space-y-1 overflow-y-auto pr-1">
                    {filteredPersonalContacts.map((contact: PersonalProjectContact) => {
                      const contactName = formatInviteeDisplayName(contact.email, contact.user);
                      const normalizedEmail = contact.email.trim().toLowerCase();
                      const existingMember = projectMembersByEmail.get(normalizedEmail);
                      const existingInvite = pendingInvitesByEmail.get(normalizedEmail);
                      const isExistingMember = Boolean(existingMember);
                      const isExistingInvite = Boolean(existingInvite);
                      const roleActionKey = existingMember
                        ? `role:${String(existingMember.userId)}`
                        : null;
                      const removeActionKey = existingMember
                        ? `remove:${String(existingMember.userId)}`
                        : null;
                      const resendActionKey = existingInvite
                        ? `resend:${String(existingInvite._id)}`
                        : null;
                      const cancelActionKey = existingInvite
                        ? `cancel:${String(existingInvite._id)}`
                        : null;
                      return (
                        <div
                          key={contact.email}
                          className="flex items-center justify-between gap-3 rounded-xl px-1 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarImage
                                src={contact.user?.profileImageUrl ?? undefined}
                                alt={contactName}
                              />
                              <AvatarFallback className="text-xs">
                                {getInitials(contactName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <span className="block truncate text-sm font-normal text-foreground">
                                {contactName}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="block truncate text-xs text-muted-foreground">
                                  {contact.email}
                                </span>
                                {isExistingMember ? (
                                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                                    In project
                                  </span>
                                ) : null}
                                {isExistingInvite ? (
                                  <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                                    Pending
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {isExistingMember && existingMember ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="group h-8 gap-1 px-2 text-xs text-muted-foreground"
                                aria-haspopup="menu"
                                disabled={
                                  isSubmitting ||
                                  !canManagePersonalProjectAccess ||
                                  existingMember.userId === convexUserId
                                }
                                onClick={async (event) => {
                                  event.preventDefault()
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
                                  const items: ContextMenuItem<string>[] = PROJECT_INVITE_ROLE_OPTIONS.map((option) => ({
                                    id: option.value,
                                    label: (t as any)(`share.role.${option.value}`) ?? option.label,
                                    type: "radio" as const,
                                    checked: existingMember.role === option.value,
                                    icon: getNativeMenuIcon("shield"),
                                    enabled:
                                      existingMember.role !== option.value &&
                                      teamActionKey !== roleActionKey &&
                                      existingMember.userId !== convexUserId,
                                  }))
                                  const action = await showDesktopContextMenu(items, position)
                                  if (action) {
                                    void handleProjectMemberRoleChange(existingMember.userId, action as ProjectInviteRole)
                                  }
                                }}
                              >
                                {teamActionKey === roleActionKey ? (
                                  <div className="loader mr-1" />
                                ) : null}
                                {(t as any)("share.role." + existingMember.role) ?? "Role"}
                                <HugeiconsIcon icon={__ChevronDownHugeIcon} className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                disabled={
                                  isSubmitting ||
                                  !canManagePersonalProjectAccess ||
                                  existingMember.userId === convexUserId ||
                                  teamActionKey === removeActionKey
                                }
                                onClick={() => {
                                  void handleProjectMemberRemove(existingMember.userId);
                                }}
                              >
                                {teamActionKey === removeActionKey ? (
                                  <div className="loader" />
                                ) : (
                                  <HugeiconsIcon icon={__Trash2HugeIcon} className="h-2.5 w-2.5" />
                                )}
                                <span className="sr-only">Remove member</span>
                              </Button>
                            </div>
                          ) : isExistingInvite && existingInvite ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 shrink-0 rounded-full px-3 text-xs"
                                disabled={
                                  isSubmitting ||
                                  !canManagePersonalProjectAccess ||
                                  teamActionKey === resendActionKey
                                }
                                onClick={() => {
                                  void handleProjectInviteResend(existingInvite._id);
                                }}
                              >
                                {teamActionKey === resendActionKey ? (
                                  <div className="loader mr-1.5" />
                                ) : (
                                  <HugeiconsIcon icon={__RefreshCwHugeIcon} className="mr-1.5 h-2.5 w-2.5" />
                                )}
                                Resend
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                disabled={
                                  isSubmitting ||
                                  !canManagePersonalProjectAccess ||
                                  teamActionKey === cancelActionKey
                                }
                                onClick={() => {
                                  void handleProjectInviteCancel(existingInvite._id);
                                }}
                              >
                                {teamActionKey === cancelActionKey ? (
                                  <div className="loader" />
                                ) : (
                                  <HugeiconsIcon icon={__Trash2HugeIcon} className="h-2.5 w-2.5" />
                                )}
                                <span className="sr-only">Cancel invite</span>
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 shrink-0 rounded-full px-3 text-xs"
                              disabled={isSubmitting}
                              onClick={() => {
                                setInviteError(null);
                                queueInviteEmail(contact.email);
                                setEmailInput("");
                              }}
                            >
                              <HugeiconsIcon icon={__PlusHugeIcon} className="mr-1.5 h-2.5 w-2.5" />
                              Add
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {inviteMembers.length > 0 ? (
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-gradient-to-t from-background to-transparent" />
                    <div className="app-scrollbar max-h-64 space-y-1 overflow-y-auto py-2">
                      {inviteMembers.map((member, index) => {
                        const inviteeUser = inviteLookupByEmail.get(member.email);
                        const inviteeName = formatInviteeDisplayName(member.email, inviteeUser);
                        return (
                          <div
                            key={member.email}
                            className="flex items-start justify-between gap-3 px-1 py-2"
                          >
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarImage
                                    src={inviteeUser?.profileImageUrl ?? undefined}
                                    alt={inviteeName}
                                  />
                                  <AvatarFallback className="text-sm">
                                    {getInitials(inviteeName)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <span className="block max-w-[220px] truncate font-normal text-foreground">
                                    {inviteeName}
                                  </span>
                                  <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
                                    {member.email}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="group h-8 gap-1 px-2 text-xs text-muted-foreground"
                                aria-haspopup="menu"
                                disabled={isSubmitting}
                                onClick={async (event) => {
                                  event.preventDefault()
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
                                  const items: ContextMenuItem<string>[] = PROJECT_INVITE_ROLE_OPTIONS.map((option) => ({
                                    id: option.value,
                                    label: (t as any)(`share.role.${option.value}`) ?? option.label,
                                    type: "radio" as const,
                                    checked: member.role === option.value,
                                    icon: getNativeMenuIcon("shield"),
                                  }))
                                  const action = await showDesktopContextMenu(items, position)
                                  if (action) {
                                    handleUpdateRole(index, action as ProjectInviteRole)
                                  }
                                }}
                              >
                                {PROJECT_INVITE_ROLE_OPTIONS.find(
                                  (option) => option.value === member.role,
                                )?.label ?? "Role"}
                                <HugeiconsIcon icon={__ChevronDownHugeIcon} className="h-3.5 w-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  handleRemoveFromInviteList(index);
                                }}
                                disabled={isSubmitting}
                              >
                                <HugeiconsIcon icon={__Trash2HugeIcon} className="h-2.5 w-2.5" />
                                <span className="sr-only">Remove invite</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-muted-foreground">
                    {t("share.membersAdded").replace("{count}", String(inviteMembers.length))}
                  </span>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleSendInvites();
                    }}
                    disabled={inviteMembers.length === 0 || isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="loader mr-2" />
                    ) : (
                      <HugeiconsIcon icon={__SendHugeIcon} className="mr-2 h-2.5 w-2.5" />
                    )}
                    {t("share.sendInvites")}
                  </Button>
                </div>

                <div className="rounded-xl bg-background/60 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <HugeiconsIcon icon={__Link2HugeIcon} className="h-2.5 w-2.5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <Select
                        value={joinLinkRole}
                        onValueChange={(value) => setJoinLinkRole(value as ProjectInviteRole)}
                        disabled={joinLinkAction !== null}
                      >
                        <SelectTrigger className="h-10 w-full rounded-full border-0 bg-muted/50 text-sm shadow-none">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROJECT_INVITE_ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {(t as any)(`share.role.${option.value}`) ?? option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60"
                      onClick={() => {
                        void handleCopyJoinLink();
                      }}
                      disabled={joinLinkAction !== null || !canManageJoinLinks}
                      title="Copy link"
                    >
                      {joinLinkAction === "copy" ? (
                        <div className="loader" />
                      ) : (
                        <HugeiconsIcon icon={__CopyHugeIcon} className="h-2.5 w-2.5" />
                      )}
                      <span className="sr-only">Copy link</span>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60"
                      disabled={joinLinkAction !== null || !canManageJoinLinks}
                      title="Link options"
                      aria-label="Link options"
                      aria-haspopup="menu"
                      onClick={async (event) => {
                        event.preventDefault()
                        const rect = event.currentTarget.getBoundingClientRect()
                        const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
                        const items: ContextMenuItem<string>[] = [
                          {
                            id: "rotate",
                            label: "Rotate link",
                            icon: getNativeMenuIcon("restore"),
                            enabled: joinLinkAction === null && canManageJoinLinks,
                          },
                          {
                            id: "disable",
                            label: "Disable link",
                            destructive: true,
                            icon: getNativeMenuIcon("close"),
                            enabled: joinLinkAction === null && canManageJoinLinks && Boolean(activeJoinLink),
                          },
                        ]
                        const action = await showDesktopContextMenu(items, position)
                        if (action === "rotate") {
                          void handleRotateJoinLink()
                        } else if (action === "disable") {
                          void handleDisableJoinLink()
                        }
                      }}
                    >
                      {joinLinkAction === "rotate" || joinLinkAction === "disable" ? (
                        <div className="loader" />
                      ) : (
                        <HugeiconsIcon icon={__MoreVerticalHugeIcon} className="h-2.5 w-2.5" />
                      )}
                      <span className="sr-only">Link options</span>
                    </Button>
                  </div>

                  <p className="mt-2 pl-[52px] text-xs text-muted-foreground">
                    {(t as any)(`share.linkDesc.${joinLinkRole}`) ?? getLinkPermissionDescription(joinLinkRole)}
                  </p>
                </div>
            </>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
