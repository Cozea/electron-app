/**
 * Deterministic Navigation Performance Test Fixtures
 * Conforms to Section 13.1 of docs/perf/navigation-runtime-plan.md
 */

export const FIXTURE_PROJECT_A = {
  projectId: 'test-project-a',
  projectName: 'Project Alpha',
  projectSlug: 'project-alpha',
  workspaceId: 'ws-alpha-1',
  workspaceRevision: 1,
  rootPath: '/tmp/cozea-fixtures/project-a',
  branches: {
    current: 'main',
    available: ['main', 'feature/navigation-rewrite'],
  },
  laneId: 'collab',
  tiles: [
    {
      id: 'tile-a-chat',
      type: 'assistant',
      title: 'AI Assistant',
      props: { timelineRowsCount: 200 },
    },
    {
      id: 'tile-a-terminal',
      type: 'terminal',
      title: 'Terminal (zsh)',
      props: { scrollbackLines: 2000 },
    },
    {
      id: 'tile-a-editor',
      type: 'editor',
      title: 'main.ts',
      props: { lineCount: 1000 },
    },
    {
      id: 'tile-a-browser',
      type: 'browser',
      title: 'Local Preview',
      props: { url: 'http://localhost:5999/preview-a' },
    },
  ],
};

export const FIXTURE_PROJECT_B = {
  projectId: 'test-project-b',
  projectName: 'Project Beta',
  projectSlug: 'project-beta',
  workspaceId: 'ws-beta-1',
  workspaceRevision: 1,
  rootPath: '/tmp/cozea-fixtures/project-b',
  branches: {
    current: 'develop',
    available: ['develop', 'staging'],
  },
  laneId: 'collab',
  tiles: [
    {
      id: 'tile-b-editor',
      type: 'editor',
      title: 'index.tsx',
      props: { lineCount: 500 },
    },
    {
      id: 'tile-b-terminal',
      type: 'terminal',
      title: 'Terminal (bash)',
      props: { scrollbackLines: 500 },
    },
    {
      id: 'tile-b-chat',
      type: 'assistant',
      title: 'Copilot',
      props: { timelineRowsCount: 50 },
    },
  ],
};

export const FIXTURE_PROJECT_C = {
  projectId: 'test-project-c',
  projectName: 'Project Gamma',
  projectSlug: 'project-gamma',
  workspaceId: 'ws-gamma-1',
  workspaceRevision: 1,
  rootPath: '/tmp/cozea-fixtures/project-c',
  branches: {
    current: 'main',
    available: ['main'],
  },
  laneId: 'collab',
  tiles: [
    {
      id: 'tile-c-editor',
      type: 'editor',
      title: 'app.py',
      props: { lineCount: 250 },
    },
  ],
};

export const FIXTURE_ADDITIONAL_PROJECTS = ['d', 'e', 'f', 'g', 'h'].map(
  (letter, index) => ({
    projectId: `test-project-${letter}`,
    projectName: `Project ${letter.toUpperCase()}`,
    projectSlug: `project-${letter}`,
    workspaceId: `ws-${letter}-1`,
    workspaceRevision: 1,
    rootPath: `/tmp/cozea-fixtures/project-${letter}`,
    branches: { current: 'main', available: ['main'] },
    laneId: 'collab',
    tiles: [
      {
        id: `tile-${letter}-editor`,
        type: 'editor',
        title: `file-${letter}.ts`,
        props: { lineCount: 100 * (index + 1) },
      },
    ],
  })
);

export const FIXTURE_BROKEN_PROJECT = {
  projectId: 'test-project-broken',
  projectName: 'Broken Project',
  projectSlug: 'project-broken',
  workspaceId: null,
  workspaceRevision: 0,
  rootPath: null,
  repairCandidates: [
    { path: '/tmp/cozea-fixtures/broken-recovery-1', score: 0.95 },
    { path: '/tmp/cozea-fixtures/broken-recovery-2', score: 0.80 },
  ],
};

export const FIXTURE_DENIED_PROJECT = {
  projectId: 'test-project-denied',
  projectName: 'Denied Project',
  projectSlug: 'project-denied',
  accessError: 'FORBIDDEN_ORGANIZATION_MEMBERSHIP',
};

export const FIXTURE_ALL_PROJECTS = [
  FIXTURE_PROJECT_A,
  FIXTURE_PROJECT_B,
  FIXTURE_PROJECT_C,
  ...FIXTURE_ADDITIONAL_PROJECTS,
];
