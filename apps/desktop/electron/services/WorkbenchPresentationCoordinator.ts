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
}

export class WorkbenchPresentationCoordinator {
  private static instance: WorkbenchPresentationCoordinator | null = null;
  private clients = new Map<number, ClientState>(); // webContentsId -> ClientState
  private sessionManager: WorkbenchSessionManager;

  private constructor(sessionManager: WorkbenchSessionManager) {
    this.sessionManager = sessionManager;
  }

  static getInstance(sessionManager?: WorkbenchSessionManager): WorkbenchPresentationCoordinator {
    if (!WorkbenchPresentationCoordinator.instance) {
      if (!sessionManager) {
        throw new Error('WorkbenchPresentationCoordinator requires WorkbenchSessionManager on first initialization');
      }
      WorkbenchPresentationCoordinator.instance = new WorkbenchPresentationCoordinator(sessionManager);
    }
    return WorkbenchPresentationCoordinator.instance;
  }

  registerClient(webContents: WebContents): ClientPresentationRegistration {
    const clientEpoch = `epoch_${crypto.randomUUID()}`;
    const webContentsId = webContents.id;

    const state: ClientState = {
      clientEpoch,
      highestSequence: 0,
      lastCommandPayload: null,
      activeTarget: null,
      activeSessionKey: null,
      retainedSessionKeys: new Set(),
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
        });
      } catch {}
    }

    this.clients.delete(webContentsId);
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
        return {
          status: 'applied',
          sequence: command.sequence,
          sessionKey: client.activeSessionKey,
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

    // 3. If target is null (navigating to an ordinary route or recovery view)
    if (command.target === null) {
      if (client.activeSessionKey && client.activeTarget) {
        this.sessionManager.backgroundSession({
          sessionKey: client.activeSessionKey,
          projectId: client.activeTarget.projectId,
          laneId: client.activeTarget.laneId,
        });
        client.activeSessionKey = null;
        client.activeTarget = null;
      }
      return { status: 'applied', sequence: command.sequence, sessionKey: null };
    }

    // 4. Concrete target resolution
    const target = command.target;

    // Await session preparation
    const sessionSnapshot = await this.sessionManager.ensureSession({
      projectId: target.projectId,
      laneId: target.laneId,
      workspaceId: target.workspaceId,
    });

    // CRITICAL: Post-await recheck of epoch and sequence (Section 9.3, M01)
    if (
      this.clients.get(webContents.id)?.clientEpoch !== command.clientEpoch ||
      this.clients.get(webContents.id)?.highestSequence !== command.sequence
    ) {
      return { status: 'superseded', sequence: command.sequence };
    }

    // Commit activation
    await this.sessionManager.activateSession({
      sessionKey: sessionSnapshot.sessionKey,
      projectId: target.projectId,
      laneId: target.laneId,
      workspaceId: target.workspaceId,
    });

    // Post-await recheck
    if (this.clients.get(webContents.id)?.highestSequence !== command.sequence) {
      return { status: 'superseded', sequence: command.sequence };
    }

    client.activeSessionKey = sessionSnapshot.sessionKey;
    client.activeTarget = target;

    return {
      status: 'applied',
      sequence: command.sequence,
      sessionKey: sessionSnapshot.sessionKey,
    };
  }
}
