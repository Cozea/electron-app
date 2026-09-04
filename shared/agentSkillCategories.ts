/**
 * The shelves the Agent Skills page groups by.
 *
 * A skill declares its own shelf with `category:` in SKILL.md frontmatter.
 * Most skills in the wild do not, so the rest are placed by keyword, which is
 * why the vocabulary is deliberately small: ten broad shelves can be guessed
 * from a name and a sentence, forty cannot.
 */

export type AgentSkillCategoryId =
  | 'memory'
  | 'code'
  | 'testing'
  | 'docs'
  | 'design'
  | 'data'
  | 'ops'
  | 'research'
  | 'workflow'
  | 'other'

export interface AgentSkillCategory {
  id: AgentSkillCategoryId
  label: string
  /** Matched against name and description when a skill declares no category. */
  keywords: readonly string[]
}

/** Display order on the page. `other` stays last so unplaced skills sink. */
export const AGENT_SKILL_CATEGORIES: readonly AgentSkillCategory[] = [
  {
    id: 'memory',
    label: 'Memory & Context',
    // 'context', 'index' and 'notes' were too common in agent skill prose —
    // they pulled in anything that merely mentioned the agent's own context.
    keywords: ['memory', 'remember', 'recall', 'knowledge graph', 'memory map', 'graph'],
  },
  {
    id: 'code',
    label: 'Coding & Review',
    keywords: [
      'code',
      'coding',
      'refactor',
      'review',
      'lint',
      'debug',
      'bug',
      'pull request',
      'diff',
      'commit',
      'git',
      'typescript',
      'python',
      'api',
      'sdk',
      'migration',
      'implement',
    ],
  },
  {
    id: 'testing',
    label: 'Testing & QA',
    keywords: [
      'test',
      'testing',
      'qa',
      'coverage',
      'regression',
      'e2e',
      'unit test',
      'assertion',
      'verify',
      'security review',
      'audit',
    ],
  },
  {
    id: 'docs',
    label: 'Documentation',
    keywords: [
      'doc',
      'docs',
      'documentation',
      'readme',
      'changelog',
      'guide',
      'tutorial',
      'write-up',
      'runbook',
      'spec',
      'pdf',
      'docx',
      'markdown',
    ],
  },
  {
    id: 'design',
    label: 'Design & UI',
    keywords: [
      'design',
      'ui',
      'ux',
      'figma',
      'frontend',
      'layout',
      'typography',
      'css',
      'component',
      'accessibility',
      'artifact',
      'mockup',
      'wireframe',
      'brand',
      'visual',
      'animation',
    ],
  },
  {
    id: 'data',
    label: 'Data & Analysis',
    keywords: [
      'data',
      'analysis',
      'analytics',
      'chart',
      'visualization',
      'dashboard',
      'metric',
      'sql',
      'query',
      'database',
      'spreadsheet',
      'xlsx',
      'csv',
      'report',
      'forecast',
    ],
  },
  {
    id: 'ops',
    label: 'Build & Deploy',
    keywords: [
      'deploy',
      'build',
      'ci',
      'pipeline',
      'release',
      'docker',
      'kubernetes',
      'infrastructure',
      'cloudflare',
      'worker',
      'server',
      'incident',
      'monitor',
      'performance',
      'observability',
      'terraform',
    ],
  },
  {
    id: 'research',
    label: 'Research & Web',
    keywords: [
      'research',
      'search',
      'web',
      'browse',
      'scrape',
      'crawl',
      'competitor',
      'market',
      'paper',
      'summarize',
      'investigate',
    ],
  },
  {
    id: 'workflow',
    label: 'Workflow & Automation',
    keywords: [
      'workflow',
      'automation',
      'automate',
      'schedule',
      'checklist',
      'plan',
      'planning',
      'standup',
      'ticket',
      'issue',
      'triage',
      'email',
      'slack',
      'calendar',
      'onboarding',
      'process',
    ],
  },
  { id: 'other', label: 'Other', keywords: [] },
]

const CATEGORY_BY_ID = new Map<string, AgentSkillCategory>(
  AGENT_SKILL_CATEGORIES.map((category) => [category.id, category]),
)

const CATEGORY_BY_LABEL = new Map<string, AgentSkillCategory>(
  AGENT_SKILL_CATEGORIES.map((category) => [category.label.toLowerCase(), category]),
)

export const DEFAULT_AGENT_SKILL_CATEGORY: AgentSkillCategoryId = 'other'

export function agentSkillCategoryLabel(id: string): string {
  return CATEGORY_BY_ID.get(id)?.label ?? AGENT_SKILL_CATEGORIES[AGENT_SKILL_CATEGORIES.length - 1].label
}

export function agentSkillCategoryOrder(id: string): number {
  const index = AGENT_SKILL_CATEGORIES.findIndex((category) => category.id === id)
  return index === -1 ? AGENT_SKILL_CATEGORIES.length : index
}

/** Accepts an id, a label, or a loose synonym a SKILL.md author might write. */
export function normalizeAgentSkillCategory(raw: string | null | undefined): AgentSkillCategoryId | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  if (!value) return null
  const direct = CATEGORY_BY_ID.get(value) ?? CATEGORY_BY_LABEL.get(value)
  if (direct) return direct.id
  for (const category of AGENT_SKILL_CATEGORIES) {
    if (category.id === 'other') continue
    if (category.keywords.some((keyword) => keyword === value)) return category.id
  }
  return null
}

/**
 * Place an undeclared skill by keyword. A hit in the name counts for more than
 * one in the description: a skill called "test-runner" is about testing even if
 * its sentence happens to mention deploys.
 */
export function inferAgentSkillCategory(input: {
  name: string
  description?: string
  slug?: string
}): AgentSkillCategoryId {
  const nameText = `${input.name} ${input.slug ?? ''}`.toLowerCase()
  const descriptionText = (input.description ?? '').toLowerCase()

  let best: AgentSkillCategoryId = DEFAULT_AGENT_SKILL_CATEGORY
  let bestScore = 0
  for (const category of AGENT_SKILL_CATEGORIES) {
    if (category.id === 'other') continue
    let score = 0
    for (const keyword of category.keywords) {
      if (nameText.includes(keyword)) score += 3
      if (descriptionText.includes(keyword)) score += 1
    }
    if (score > bestScore) {
      best = category.id
      bestScore = score
    }
  }
  return bestScore > 0 ? best : DEFAULT_AGENT_SKILL_CATEGORY
}

export function resolveAgentSkillCategory(
  declared: string | null | undefined,
  input: { name: string; description?: string; slug?: string },
): AgentSkillCategoryId {
  return normalizeAgentSkillCategory(declared) ?? inferAgentSkillCategory(input)
}
