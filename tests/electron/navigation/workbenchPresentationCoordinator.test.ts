import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkbenchPresentationCoordinator } from '../../../apps/desktop/electron/services/WorkbenchPresentationCoordinator';
import type { PresentationCommand } from '@shared/navigationRuntimeTypes';

describe('WorkbenchPresentationCoordinator (M01-M09, P05)', () => {
  let mockSessionManager: any;
  let coordinator: WorkbenchPresentationCoordinator;
  let mockWebContents: any;

  beforeEach(() => {
    mockSessionManager = {
      ensureSession: vi.fn(async ({ projectId, laneId, workspaceId }) => ({
        sessionKey: `${projectId}::${laneId}::${workspaceId ?? 'default'}`,
      })),
      activateSession: vi.fn(async () => ({})),
      backgroundSession: vi.fn(() => ({})),
      closeSession: vi.fn(async () => ({ success: true })),
    };

    let destroyedCallback: (() => void) | null = null;
    mockWebContents = {
      id: 42,
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'destroyed') destroyedCallback = cb;
      }),
      destroy: () => {
        if (destroyedCallback) destroyedCallback();
      },
    };

    // Reset coordinator singleton for clean test isolation
    (WorkbenchPresentationCoordinator as any).instance = null;
    coordinator = WorkbenchPresentationCoordinator.getInstance(mockSessionManager as any);
  });

  it('Registers a trusted client and issues a unique clientEpoch', () => {
    const reg = coordinator.registerClient(mockWebContents);
    expect(reg.clientEpoch).toMatch(/^epoch_/);
    expect(reg.currentSnapshotRevision).toBeGreaterThan(0);
  });

  it('M01: Sequence 2 overtakes sequence 1 while sequence 1 is delayed; sequence 1 is rejected as superseded', async () => {
    const reg = coordinator.registerClient(mockWebContents);

    let resolveSeq1Ensure: (val: any) => void = () => {};
    let ensureCall = 0;

    mockSessionManager.ensureSession = vi.fn(async (args) => {
      ensureCall++;
      if (ensureCall === 1) {
        return new Promise((r) => {
          resolveSeq1Ensure = r;
        });
      }
      return { sessionKey: `${args.projectId}::${args.laneId}::${args.workspaceId}` };
    });

    const cmd1: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 1,
      navigationId: 10,
      target: { projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    const cmd2: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 2,
      navigationId: 11,
      target: { projectId: 'p2', workspaceId: 'w2', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    // Send command 1 (slow)
    const p1 = coordinator.applyPresentationCommand(mockWebContents, cmd1);

    // Send command 2 (fast)
    const p2 = coordinator.applyPresentationCommand(mockWebContents, cmd2);

    const res2 = await p2;
    expect(res2.status).toBe('applied');

    // Resolve command 1 after command 2 already applied
    resolveSeq1Ensure({ sessionKey: 'p1::collab::w1' });
    const res1 = await p1;

    // Command 1 must report superseded and NOT activate p1!
    expect(res1.status).toBe('superseded');
    expect(mockSessionManager.activateSession).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.activateSession).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2' })
    );
  });

  it('M02: Retry of identical sequence/payload returns idempotent success', async () => {
    const reg = coordinator.registerClient(mockWebContents);

    const cmd: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 1,
      navigationId: 1,
      target: { projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    const res1 = await coordinator.applyPresentationCommand(mockWebContents, cmd);
    expect(res1.status).toBe('applied');

    const res2 = await coordinator.applyPresentationCommand(mockWebContents, cmd);
    expect(res2.status).toBe('applied');
    // Ensure session was not called twice for the same idempotent command
    expect(mockSessionManager.activateSession).toHaveBeenCalledTimes(1);
  });

  it('M03: Same sequence with different payload or retired epoch is rejected without mutation', async () => {
    const reg = coordinator.registerClient(mockWebContents);

    const cmd1: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 5,
      navigationId: 1,
      target: { projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    await coordinator.applyPresentationCommand(mockWebContents, cmd1);

    // Conflicting payload for sequence 5
    const cmdConflicting: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 5,
      navigationId: 2,
      target: { projectId: 'p2', workspaceId: 'w2', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    const conflictRes = await coordinator.applyPresentationCommand(mockWebContents, cmdConflicting);
    expect(conflictRes.status).toBe('invalidated');

    // Retired epoch
    const cmdBadEpoch: PresentationCommand = {
      clientEpoch: 'epoch_retired_9999',
      sequence: 6,
      navigationId: 3,
      target: null,
      retained: [],
    };

    const epochRes = await coordinator.applyPresentationCommand(mockWebContents, cmdBadEpoch);
    expect(epochRes.status).toBe('invalidated');
  });

  it('M04: Client destruction/reload invalidates old epoch and backgrounds active session', async () => {
    const reg = coordinator.registerClient(mockWebContents);

    const cmd: PresentationCommand = {
      clientEpoch: reg.clientEpoch,
      sequence: 1,
      navigationId: 1,
      target: { projectId: 'p1', workspaceId: 'w1', workspaceRevision: 1, laneId: 'collab' },
      retained: [],
    };

    await coordinator.applyPresentationCommand(mockWebContents, cmd);
    expect(mockSessionManager.backgroundSession).not.toHaveBeenCalled();

    // Trigger destruction
    mockWebContents.destroy();
    expect(mockSessionManager.backgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'p1::collab::w1' })
    );

    // Attempting to send command with old epoch now fails
    const postDestroyRes = await coordinator.applyPresentationCommand(mockWebContents, {
      ...cmd,
      sequence: 2,
    });
    expect(postDestroyRes.status).toBe('invalidated');
  });
});
