/**
 * Navigation Intent & Transaction Controller
 * Conforms to Section 5.1 & 5.2 of docs/perf/navigation-runtime-plan.md
 */

import type {
  ResolvedWorkbenchIdentity,
  PresentationCommand,
} from '@shared/navigationRuntimeTypes';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

class NavigationController {
  private commandSequence = 0;
  private clientEpoch: string | null = null;
  private isRegistered = false;

  async init(): Promise<void> {
    if (this.isRegistered || typeof window === 'undefined') return;
    const api = window.electronAPI?.workbenchSession;
    if (!api?.registerPresentationClient) return;

    try {
      const reg = await api.registerPresentationClient();
      this.clientEpoch = reg.clientEpoch;
      this.isRegistered = true;
    } catch (err) {
      console.warn('[NavigationController] Client registration failed:', err);
    }
  }

  async setPresentation(
    target: ResolvedWorkbenchIdentity | null,
    retained: readonly ResolvedWorkbenchIdentity[] = []
  ): Promise<void> {
    await this.init();
    if (!this.clientEpoch) return;

    const api = window.electronAPI?.workbenchSession;
    if (!api?.setPresentation) return;

    const navId = navigationMetrics.nextNavigationId();
    this.commandSequence++;

    const command: PresentationCommand = {
      clientEpoch: this.clientEpoch,
      sequence: this.commandSequence,
      navigationId: navId,
      target,
      retained,
    };

    navigationMetrics.increment('presentationRequests');

    try {
      const result = await api.setPresentation(command);
      if (result.status === 'applied') {
        navigationMetrics.increment('presentationApplies');
      } else if (result.status === 'superseded') {
        navigationMetrics.increment('presentationSuperseded');
      }
    } catch (err) {
      console.warn('[NavigationController] setPresentation failed:', err);
    }
  }
}

export const navigationController = new NavigationController();
