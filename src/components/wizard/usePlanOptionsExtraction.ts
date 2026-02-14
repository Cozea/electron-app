import { useEffect, useRef, useState } from 'react'
import type { UIMessage } from 'ai'

import type { PlanOption } from './PlanSelector'

interface ToolPart {
  type: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  result?: unknown
  args?: unknown
  plans?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function validatePlans(plans: unknown[]): PlanOption[] {
  return plans
    .filter((plan): plan is PlanOption => {
      if (!plan || typeof plan !== 'object') return false
      const candidate = plan as Record<string, unknown>
      return (
        typeof candidate.tier === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.description === 'string' &&
        Array.isArray(candidate.features)
      )
    })
    .map((plan) => ({
      ...plan,
      tier: (plan.tier?.toLowerCase?.() || 'prototype') as 'prototype' | 'beta' | 'mvp',
      features: plan.features || [],
      config: plan.config || {},
    }))
}

export function usePlanOptionsExtraction(messages: UIMessage[]): PlanOption[] | null {
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null)
  const extractedPlanCountRef = useRef(0)

  useEffect(() => {
    if (extractedPlanCountRef.current >= 3) return

    for (const message of messages) {
      if (message.role !== 'assistant') continue

      for (const part of message.parts) {
        const partType = part.type as string
        const toolPart = part as ToolPart
        const isPresentPlans =
          partType === 'tool-plan_write' ||
          partType.includes('plan_write') ||
          toolPart.toolName === 'plan_write' ||
          (partType === 'tool-invocation' && toolPart.toolName === 'plan_write') ||
          (partType === 'tool-result' && toolPart.toolName === 'plan_write')

        if (isPresentPlans) {
          const rawOutput = toolPart.output ?? toolPart.result
          const rawInput = toolPart.input ?? toolPart.args

          if ((toolPart.state === 'output-available' || toolPart.state === 'result') && rawOutput) {
            try {
              const output = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput
              if (isRecord(output) && Array.isArray(output.plans)) {
                const validPlans = validatePlans(output.plans)
                if (validPlans.length > extractedPlanCountRef.current) {
                  extractedPlanCountRef.current = validPlans.length
                  setPlanOptions(validPlans)
                  if (validPlans.length >= 3) return
                }
              }
            } catch (error) {
              console.warn('Failed to parse plan output:', error)
            }
          } else if (isRecord(rawInput) && Array.isArray(rawInput.plans)) {
            const validPlans = validatePlans(rawInput.plans)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          } else if (Array.isArray(toolPart.plans)) {
            const validPlans = validatePlans(toolPart.plans)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          }
        }

        if (part.type === 'data-plan-options') {
          const data = (part as { data?: unknown }).data
          if (Array.isArray(data)) {
            const validPlans = validatePlans(data)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          }
        }
      }
    }
  }, [messages])

  return planOptions
}
