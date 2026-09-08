/**
 * Navigation Intent & Transaction Controller
 * Conforms to Section 5.1 & 5.2 of docs/perf/navigation-runtime-plan.md
 */

import type {
  ResolvedWorkbenchIdentity,
  PresentationCommand,
  PresentationCommandResult,
} from '@shared/navigationRuntimeTypes';
import { navigationMetrics } from '@/lib/performance/navigationMetrics';

class NavigationController {
  private commandSequence = 0;
  private clientEpoch: string | null = null;
  private isRegistered = false;
  private registration: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.isRegistered || typeof window === 'undefined') return;
    if (this.registration) return this.registration;
    const api = window.electronAPI?.workbenchSession;
    if (!api?.registerPresentationClient) return;

    const attempt = api.registerPresentationClient().then((reg) => {
      this.clientEpoch = reg.clientEpoch;
      this.isRegistered = true;
    }).finally(() => {
      if (this.registration === attempt) this.registration = null;
    });
    this.registration = attempt;
    return attempt;
  }

  async setPresentation(
    target: ResolvedWorkbenchIdentity | null,
    retained: readonly ResolvedWorkbenchIdentity[] = []
  ): Promise<PresentationCommandResult | null> {
    // Reserve ordering before registration awaits so overlapping cleanup and
    // activation calls retain renderer intent order.
    const sequence = ++this.commandSequence;
    try {
      await this.init();
    } catch (err) {
      console.warn('[NavigationController] Client registration failed:', err);
      return null;
    }
    if (!this.clientEpoch) return null;

    const api = window.electronAPI?.workbenchSession;
    if (!api?.setPresentation) return null;

    const navId = navigationMetrics.nextNavigationId();
    const command: PresentationCommand = {
      clientEpoch: this.clientEpoch,
      sequence,
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
      return result;
    } catch (err) {
      console.warn('[NavigationController] setPresentation failed:', err);
      return null;
    }
  }
}

export const navigationController = new NavigationController();
