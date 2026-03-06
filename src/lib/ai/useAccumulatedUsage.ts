import { useMemo } from 'react'
import type { UIMessage } from 'ai'

interface UsageData {
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  spendCents?: number
}

interface AgentLedgerData {
  kind?: 'run_started' | 'step' | 'budget_exceeded' | 'run_completed'
  runId?: string
  costUsd?: number
  billedUsd?: number
}

export function useAccumulatedUsage(messages: UIMessage[]) {
  return useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cachedInputTokens = 0
    let usageSpendCents = 0
    const runCosts = new Map<string, number>()

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'data-usage') {
          const data = (part as { data?: UsageData }).data
          if (data) {
            inputTokens += data.promptTokens ?? 0
            outputTokens += data.completionTokens ?? 0
            reasoningTokens += data.reasoningTokens ?? 0
            cachedInputTokens += data.cachedInputTokens ?? 0
            usageSpendCents += Math.max(0, data.spendCents ?? 0)
          }
        }
        if (part.type === 'data-agent-ledger') {
          const data = (part as { data?: AgentLedgerData }).data
          const runId = typeof data?.runId === 'string' ? data.runId : undefined
          if (!runId) continue

          if (data?.kind === 'step' && typeof data.costUsd === 'number' && Number.isFinite(data.costUsd)) {
            runCosts.set(runId, (runCosts.get(runId) ?? 0) + Math.max(0, data.costUsd))
          }
          if (data?.kind === 'run_completed' && typeof data.billedUsd === 'number' && Number.isFinite(data.billedUsd)) {
            runCosts.set(runId, Math.max(0, data.billedUsd))
          }
        }
      }
    }

    const totalTokens = inputTokens + outputTokens
    const totalCostUsd =
      runCosts.size > 0
        ? Array.from(runCosts.values()).reduce((sum, value) => sum + value, 0)
        : usageSpendCents / 100

    return {
      usedTokens: totalTokens,
      totalCostUsd,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        reasoningTokens: reasoningTokens || undefined,
        cachedInputTokens: cachedInputTokens || undefined,
        inputTokenDetails: {
          noCacheTokens: inputTokens - cachedInputTokens,
          cacheReadTokens: cachedInputTokens || undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: outputTokens - reasoningTokens,
          reasoningTokens: reasoningTokens || undefined,
        },
      },
    }
  }, [messages])
}
