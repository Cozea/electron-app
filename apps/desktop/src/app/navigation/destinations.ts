/**
 * Canonical Destination Module Loaders & Warming Registry
 * Conforms to Section 11 of docs/perf/navigation-runtime-plan.md
 */

import { settingsModules } from '@/lib/settings/settingsModules';
import { destinationModules } from '@/app/navigation/destinationModules';

export type RouteDestinationKind =
  | 'projects'
  | 'workbench'
  | 'store'
  | 'skills'
  | 'inbox'
  | 'tasks'
  | 'newProject'
  | 'settingsAccount'
  | 'settingsAppearance'
  | 'settingsOrganizations'
  | 'settingsTooling'
  | 'settingsDevApps'
  | string;

export interface DestinationDefinition {
  loader: () => Promise<unknown>;
  pathPrefix: string;
}

const DESTINATION_DEFINITIONS: Record<string, DestinationDefinition> = {
  '/projects': {
    loader: destinationModules.projects,
    pathPrefix: '/projects',
  },
  '/projects/store': {
    loader: destinationModules.store,
    pathPrefix: '/projects/store',
  },
  '/projects/skills': {
    loader: destinationModules.skills,
    pathPrefix: '/projects/skills',
  },
  '/projects/inbox': {
    loader: destinationModules.inbox,
    pathPrefix: '/projects/inbox',
  },
  '/projects/tasks': {
    loader: destinationModules.tasks,
    pathPrefix: '/projects/tasks',
  },
  '/projects/new': {
    loader: destinationModules.newProject,
    pathPrefix: '/projects/new',
  },
  'workbench': {
    loader: destinationModules.workbench,
    pathPrefix: '/workbench',
  },
  '/projects/settings/account': {
    loader: settingsModules.account,
    pathPrefix: '/projects/settings/account',
  },
  '/projects/settings/appearance': {
    loader: settingsModules.appearance,
    pathPrefix: '/projects/settings/appearance',
  },
  '/projects/settings/organizations': {
    loader: settingsModules.organizations,
    pathPrefix: '/projects/settings/organizations',
  },
  '/projects/settings/tooling': {
    loader: settingsModules.tooling,
    pathPrefix: '/projects/settings/tooling',
  },
  '/projects/settings/devapps': {
    loader: settingsModules.devapps,
    pathPrefix: '/projects/settings/devapps',
  },
};

// Cached single-flight promises per destination (Section 11.1)
const loaderPromises = new Map<string, Promise<unknown>>();

export function getDestinationLoader(destinationKey: string): (() => Promise<unknown>) | null {
  const def = DESTINATION_DEFINITIONS[destinationKey];
  if (!def) return null;

  return () => {
    let existing = loaderPromises.get(destinationKey);
    if (existing) {
      return existing;
    }

    const promise = def.loader().catch((err) => {
      // Clear cached promise on failure so future navigations can retry (Section 11.1)
      loaderPromises.delete(destinationKey);
      throw err;
    });

    loaderPromises.set(destinationKey, promise);
    return promise;
  };
}

export function prewarmDestination(destinationKey: string): Promise<unknown> | null {
  const loader = getDestinationLoader(destinationKey);
  if (!loader) return null;
  return loader().catch(() => null);
}

export function warmCommonDestinations(): void {
  const commonKeys = [
    '/projects/store',
    '/projects/skills',
    '/projects/inbox',
    '/projects/tasks',
    '/projects/settings/account',
    '/projects/settings/appearance',
  ];

  // Limit speculative concurrency to two (Section 11.2)
  let queueIndex = 0;
  function processNext() {
    if (queueIndex >= commonKeys.length) return;
    const key = commonKeys[queueIndex++];
    void prewarmDestination(key)?.then(() => processNext());
  }

  processNext();
  processNext();
}
