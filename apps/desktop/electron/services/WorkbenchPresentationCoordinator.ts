/**
 * Workbench Presentation Coordinator (Main Process Authority)
 * Conforms to Section 9 of docs/perf/navigation-runtime-plan.md
 * 
 * Rules:
 * - Issues main-generated epochs bound to trusted WebContents (Section 9.2, M04)
 * - Last-writer-wins sequenced command processing (Section 9.3, M01-M03)
 * - Rechecks epoch and sequence after EVERY await before committing activation (Section 9.3, M01)
 * - Strict concrete-identity lookup; no fallback across workspaces (Section 9.4, M05)
 * - Manages foreground and resident presentation leases (Section 9.5, M07, M08)
 */

import crypto from 'node:crypto';
import type { WebContents } from 'electron';
import {
  type PresentationCommand,
  type PresentationCommandResult,
  type ClientPresentationRegistration,
  validatePresentationCommand,
} from '@shared/navigationRuntimeTypes';
import { WorkbenchSessionManager } from './WorkbenchSessionManager';

interface ClientState {
  clientEpoch: string;
  highestSequence: number;
  lastCommandPayload: PresentationCommand | null;
  activeTarget: import('@shared/navigationRuntimeTypes').ResolvedWorkbenchIdentity | null;
  activeSessionKey: string | null;
  retainedSessionKeys: Set<string>;
  pendingResults: Map<number, Promise<PresentationCommandResult>>;
}

type TargetValidator = (
  target: import('@shared/navigationRuntimeTypes').ResolvedWorkbenchIdentity,
) => Promise<boolean>;

export class WorkbenchPresentationCoordinator {
  private static instance: WorkbenchPresentationCoordinator | null = null;
  private clients = new Map<number, ClientState>(); // webContentsId -> ClientState
  private sessionManager: WorkbenchSessionManager;
  private targetValidator: TargetValidator;

  private constructor(sessionManager: WorkbenchSessionManager, targetValidator: TargetValidator) {
    this.sessionManager = sessionManager;
    this.targetValidator = targetValidator;
  }

  static getInstance(
    sessionManager?: WorkbenchSessionManager,
    targetValidator: TargetValidator = async () => true,
  ): WorkbenchPresentationCoordinator {
    if (!WorkbenchPresentationCoordinator.instance) {
      if (!sessionManager) {
        throw new Error('WorkbenchPresentationCoordinator requires WorkbenchSessionManager on first initialization');
      }
      WorkbenchPresentationCoordinator.instance = new WorkbenchPresentationCoordinator(
        sessionManager,
        targetValidator,
      );
    }
    return WorkbenchPresentationCoordinator.instance;
  }

  registerClient(webContents: WebContents): ClientPresentationRegistration {
    const clientEpoch = `epoch_${crypto.randomUUID()}`;
    const webContentsId = webContents.id;

    const state: ClientState = {
      clientEpoch,
      highestSequence: -1,
      lastCommandPayload: null,
      activeTarget: null,
      activeSessionKey: null,
      retainedSessionKeys: new Set(),
      pendingResults: new Map(),
    };

    this.clients.set(webContentsId, state);

    // Clean up leases and client epoch on reload or destruction (M04)
    webContents.once('destroyed', () => {
      this.handleClientDestroyed(webContentsId);
    });

    return {
      clientEpoch,
      currentSnapshotRevision: Date.now(),
    };
  }

  private handleClientDestroyed(webContentsId: number): void {
    const client = this.clients.get(webContentsId);
    if (!client) return;

    if (client.activeSessionKey && client.activeTarget) {
      try {
        this.sessionManager.backgroundSession({
          sessionKey: client.activeSessionKey,
          projectId: client.activeTarget.projectId,
          laneId: client.activeTarget.laneId,
          workspaceId: client.activeTarget.workspaceId,
          workspaceRevision: client.activeTarget.workspaceRevision,
        });
      } catch {}
    }

    this.sessionManager.releasePresentationLeases(String(webContentsId));

    this.clients.delete(webContentsId);
  }

  private isCurrent(webContentsId: number, command: PresentationCommand): boolean {
    const client = this.clients.get(webContentsId);
    return Boolean(
      client &&
        client.clientEpoch === command.clientEpoch &&
        client.highestSequence === command.sequence,
    );
  }

  private updateRetainedLeases(webContentsId: number, command: PresentationCommand): void {
    const client = this.clients.get(webContentsId);
    if (!client) return;
    const retainedSessionKeys = new Set<string>();
    for (const retained of command.retained) {
      const snapshot = this.sessionManager.getSession(retained);
      if (snapshot) retainedSessionKeys.add(snapshot.sessionKey);
    }
    client.retainedSessionKeys = retainedSessionKeys;
    this.sessionManager.setPresentationLeases(String(webContentsId), retainedSessionKeys);
  }

  async applyPresentationCommand(
    webContents: WebContents,
    command: unknown
  ): Promise<PresentationCommandResult> {
    // 1. Validate payload syntax and bounds (M03)
    if (!validatePresentationCommand(command)) {
      return { status: 'invalidated', sequence: -1, reason: 'Malformed PresentationCommand payload' };
    }

    const client = this.clients.get(webContents.id);
    if (!client || client.clientEpoch !== command.clientEpoch) {
      return {
        status: 'invalidated',
        sequence: command.sequence,
        reason: 'Client epoch not recognized or retired (M04)',
      };
    }

    // 2. Sequence ordering checks (Section 9.3)
    if (command.sequence < client.highestSequence) {
      // Sequence is older than highest accepted; reject as superseded (M01)
      return { status: 'superseded', sequence: command.sequence };
    }

    if (command.sequence === client.highestSequence) {
      // Idempotent retry of identical command (M02)
      if (JSON.stringify(command) === JSON.stringify(client.lastCommandPayload)) {
        return client.pendingResults.get(command.sequence) ?? {
          status: 'applied', sequence: command.sequence, sessionKey: client.activeSessionKey,
        };
      }
      // Conflicting equal-sequence payload -> reject (M03)
      return {
        status: 'invalidated',
        sequence: command.sequence,
        reason: 'Conflicting command payload for existing sequence number',
      };
    }

    // Advance highest accepted sequence immediately before awaiting
    client.highestSequence = command.sequence;
    client.lastCommandPayload = command;

    const result = this.executePresentationCommand(webContents.id, command);
    client.pendingResults.set(command.sequence, result);
    void result.finally(() => {
      const currentClient = this.clients.get(webContents.id);
      if (currentClient?.pendingResults.get(command.sequence) === result) {
        currentClient.pendingResults.delete(command.sequence);
      }
    });
    return result;
  }

  private async executePresentationCommand(
    webContentsId: number,
    command: PresentationCommand,
  ): Promise<PresentationCommandResult> {
    const client = this.clients.get(webContentsId);
    if (!client) return { status: 'superseded', sequence: command.sequence };

    // 3. If target is null (navigating to an ordinary route or recovery view)
    if (command.target === null) {
      this.updateRetainedLeases(webContentsId, command);
      if (client.activeSessionKey && client.activeTarget) {
        this.sessionManager.backgroundSession({
          sessionKey: client.activeSessionKey,
          projectId: client.activeTarget.projectId,
          laneId: client.activeTarget.laneId,
          workspaceId: client.activeTarget.workspaceId,
          workspaceRevision: client.activeTarget.workspaceRevision,
        });
        client.activeSessionKey = null;
        client.activeTarget = null;
      }
      return { status: 'applied', sequence: command.sequence, sessionKey: null };
    }

    // 4. Concrete target resolution
    const target = command.target;

    if (!(await this.targetValidator(target))) {
      return {
        status: 'invalidated',
        sequence: command.sequence,
        reason: 'Workspace binding is missing, stale, or no longer authoritative',
      };
    }
    if (!this.isCurrent(webContentsId, command)) {
      return { status: 'superseded', sequence: command.sequence };
    }

    if (
      client.activeSessionKey &&
      client.activeTarget &&
      client.activeTarget.projectId === target.projectId &&
      client.activeTarget.workspaceId === target.workspaceId &&
      client.activeTarget.workspaceRevision === target.workspaceRevision &&
      client.activeTarget.laneId === target.laneId
    ) {
      this.updateRetainedLeases(webContentsId, command);
      return {
        status: 'applied',
        sequence: command.sequence,
        sessionKey: client.activeSessionKey,
      };
    }

    // A catalog binding revision invalidates all runtime resources owned by
    // the prior binding, even when the normalized workspace path is unchanged.
    await this.sessionManager.closeSupersededBindingSessions(target);
    if (!this.isCurrent(webContentsId, command)) {
      return { status: 'superseded', sequence: command.sequence };
    }

    // Await session preparation
    const sessionSnapshot = await this.sessionManager.ensureSession({
      projectId: target.projectId,
      laneId: target.laneId,
      workspaceId: target.workspaceId,
      workspaceRevision: target.workspaceRevision,
    });

    // CRITICAL: Post-await recheck of epoch and sequence (Section 9.3, M01)
    if (
      !this.isCurrent(webContentsId, command)
    ) {
      return { status: 'superseded', sequence: command.sequence };
    }

    // Publish the pending foreground owner before activation. A newer ordinary
    // route command can then background it even if it arrives after the
    // session mutation but before this await resumes.
    client.activeSessionKey = sessionSnapshot.sessionKey;
    client.activeTarget = target;

    // Commit activation
    const activated = await this.sessionManager.activateSessionGuarded({
      sessionKey: sessionSnapshot.sessionKey,
      projectId: target.projectId,
      laneId: target.laneId,
      workspaceId: target.workspaceId,
      workspaceRevision: target.workspaceRevision,
    }, async () => {
      if (!this.isCurrent(webContentsId, command)) return false;
      if (!(await this.targetValidator(target))) return false;
      return this.isCurrent(webContentsId, command);
    });

    if (!activated) {
      const currentClient = this.clients.get(webContentsId);
      if (currentClient?.activeSessionKey === sessionSnapshot.sessionKey) {
        currentClient.activeSessionKey = null;
        currentClient.activeTarget = null;
      }
      return { status: 'superseded', sequence: command.sequence };
    }

    if (!this.isCurrent(webContentsId, command)) {
      const currentClient = this.clients.get(webContentsId);
      if (currentClient?.activeSessionKey === sessionSnapshot.sessionKey) {
        this.sessionManager.backgroundSession({
          sessionKey: sessionSnapshot.sessionKey,
          projectId: target.projectId,
          laneId: target.laneId,
          workspaceId: target.workspaceId,
          workspaceRevision: target.workspaceRevision,
        });
        currentClient.activeSessionKey = null;
        currentClient.activeTarget = null;
      }
      return { status: 'superseded', sequence: command.sequence };
    }

    this.updateRetainedLeases(webContentsId, command);

    return {
      status: 'applied',
      sequence: command.sequence,
      sessionKey: sessionSnapshot.sessionKey,
    };
  }
}
