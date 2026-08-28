import type { DevCommandCandidate, DevCommandFeatures } from './devCommandCandidates'

export type LocalAutomationEngine = 'coreml' | 'deterministic_fallback' | 'validated_cache'

export interface DevCommandCandidateScore {
  candidateId: string
  score: number
}

export interface DevCommandResolution {
  selected: DevCommandCandidate | null
  confidence: number
  engine: LocalAutomationEngine
  scores: DevCommandCandidateScore[]
}

const FEATURE_WEIGHTS: Readonly<Record<keyof DevCommandFeatures, number>> = {
  manifestMatch: 0.12,
  scriptNameScore: 0.22,
  serverSignal: 0.16,
  packageManagerMatch: 0.08,
  frameworkMatch: 0.08,
  readmeMatch: 0.08,
  staticSiteMatch: 0.24,
  runtimeAvailable: 0.08,
  verifiedCommand: 0.18,
  productionPenalty: -0.16,
}

const SCORE_BIAS = 0.08
const MIN_SELECTION_SCORE = 0.54

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function scoreDevCommandFeatures(features: DevCommandFeatures): number {
  let score = SCORE_BIAS
  for (const [name, weight] of Object.entries(FEATURE_WEIGHTS) as Array<
    [keyof DevCommandFeatures, number]
  >) {
    score += features[name] * weight
  }
  return clampScore(score)
}

export function selectDevCommandCandidate(
  candidates: readonly DevCommandCandidate[],
  predictedScores?: readonly DevCommandCandidateScore[],
  engine: LocalAutomationEngine = 'deterministic_fallback',
): DevCommandResolution {
  const predictedById = new Map(
    (predictedScores ?? []).map((entry) => [entry.candidateId, clampScore(entry.score)]),
  )
  const scores = candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      score: predictedById.get(candidate.id) ?? scoreDevCommandFeatures(candidate.features),
    }))
    .sort((left, right) => right.score - left.score)

  const winner = scores[0]
  if (!winner || winner.score < MIN_SELECTION_SCORE) {
    return { selected: null, confidence: winner?.score ?? 0, engine, scores }
  }

  return {
    selected: candidates.find((candidate) => candidate.id === winner.candidateId) ?? null,
    confidence: winner.score,
    engine,
    scores,
  }
}
