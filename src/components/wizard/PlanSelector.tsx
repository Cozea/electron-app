import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { Check, Zap, Rocket, Crown, Loader2, Expand, ChevronLeft } from 'lucide-react'
import { IconBrandGithub, IconBrandGitlab } from '@tabler/icons-react'
import type { BuildContract, TargetPlatform } from '@/lib/plan'
import { validateWebOnlyPlanConfig } from '@/lib/plan'

export interface PlanConfig {
  name?: string
  description?: string
  audience?: string
  template?: string
  targetPlatform?: TargetPlatform
  buildContract?: BuildContract
  stack?: {
    backend: string
    hosting: string
    aiProvider: string
  }
  sourceControl?: {
    provider?: string
    repoUrl?: string
    visibility?: string
    mergeStrategy?: string
  }
  visuals?: {
    uiLibrary: string
    vibeDescription?: string
    colorPreset?: string
    primaryColor: string
    secondaryColor: string
    accentColor: string
    logoUrl?: string
  }
  generatedPlan?: {
    pages: Array<{
      id: string
      name: string
      route: string
      type: string
      purpose?: string
      actions?: string[]
    }>
    entities: Array<{
      id: string
      name: string
      fields?: string[]
    }>
  }
}

export interface PlanOption {
  tier: 'prototype' | 'beta' | 'mvp'
  name: string
  description: string
  features: string[]
  estimatedScope?: string
  config: PlanConfig
}

type TierType = 'prototype' | 'beta' | 'mvp'

function getPlanSourceControlProvider(plan: PlanOption): 'github' | 'gitlab' | null {
  return plan.config?.sourceControl?.provider === 'gitlab'
    ? 'gitlab'
    : plan.config?.sourceControl?.provider === 'github'
      ? 'github'
      : null
}

function PlanSourceControlBadge({ plan }: { plan: PlanOption }) {
  const provider = getPlanSourceControlProvider(plan)
  if (!provider) return null

  const Icon = provider === 'gitlab' ? IconBrandGitlab : IconBrandGithub
  const label = provider === 'gitlab' ? 'GitLab' : 'GitHub'

  return (
    <Badge variant="secondary" className="gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Badge>
  )
}

const tierConfig = {
  prototype: {
    icon: Zap,
    label: 'Prototype',
    description: 'Quick proof of concept',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    borderColor: 'border-yellow-500',
  },
  beta: {
    icon: Rocket,
    label: 'Beta',
    description: 'Core features ready',
    color: 'text-blue-500',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    borderColor: 'border-blue-500',
  },
  mvp: {
    icon: Crown,
    label: 'MVP',
    description: 'Production ready',
    color: 'text-purple-500',
    bgColor: 'bg-purple-100 dark:bg-purple-900',
    borderColor: 'border-purple-500',
  },
}

// Compact square card for grid view
interface CompactPlanCardProps {
  plan: PlanOption
  isSelected: boolean
  isSelectable: boolean
  onSelect: () => void
  onExpand: () => void
}

function CompactPlanCard({ plan, isSelected, isSelectable, onSelect, onExpand }: CompactPlanCardProps) {
  const normalizedTier = (plan.tier?.toLowerCase?.() || 'prototype') as keyof typeof tierConfig
  const tierInfo = tierConfig[normalizedTier] || tierConfig.prototype
  const Icon = tierInfo.icon

  return (
    <Card
      className={cn(
        'relative aspect-square cursor-pointer transition-all duration-200',
        'rounded-[1.75rem] bg-muted/45 dark:bg-muted/25 shadow-none border-0',
        'hover:scale-[1.01] hover:bg-muted/55 dark:hover:bg-muted/30',
        isSelected && 'bg-muted/65 dark:bg-muted/35',
        !isSelectable && 'opacity-65',
      )}
      onClick={onSelect}
    >
      {/* Tier badge */}
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Badge variant="outline" className={cn('gap-1', tierInfo.bgColor, tierInfo.borderColor)}>
          <Icon className={cn('h-3 w-3', tierInfo.color)} />
          <span className={tierInfo.color}>{tierInfo.label}</span>
        </Badge>
      </div>

      <CardContent className="flex flex-col items-center justify-center h-full text-center p-4 pt-6">
        <h3 className="font-medium text-xs line-clamp-2 mb-1">{plan.name || 'Untitled Plan'}</h3>
        {plan.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{plan.description}</p>
        )}
        <div className="mt-1">
          <PlanSourceControlBadge plan={plan} />
        </div>
        {plan.estimatedScope && (
          <p className="mt-1 text-[10px] text-muted-foreground/70">{plan.estimatedScope}</p>
        )}
      </CardContent>

      {/* Expand button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute bottom-2 right-2 h-7 w-7 opacity-60 hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          onExpand()
        }}
      >
        <Expand className="h-4 w-4" />
      </Button>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2">
          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        </div>
      )}
    </Card>
  )
}

// Expanded full-width card with all details
interface ExpandedPlanCardProps {
  plan: PlanOption
  isSelected: boolean
  isSelectable: boolean
  onSelect: () => void
  onCollapse: () => void
  onConfirm: () => void
  isConfirming: boolean
}

function ExpandedPlanCard({ plan, isSelected, isSelectable, onSelect, onCollapse, onConfirm, isConfirming }: ExpandedPlanCardProps) {
  const normalizedTier = (plan.tier?.toLowerCase?.() || 'prototype') as keyof typeof tierConfig
  const tierInfo = tierConfig[normalizedTier] || tierConfig.prototype
  const Icon = tierInfo.icon

  return (
    <Card className="w-full rounded-[1.75rem] bg-muted/45 dark:bg-muted/25 shadow-none border-0">
      {/* Header with back button */}
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="outline" className={cn('gap-1', tierInfo.bgColor, tierInfo.borderColor)}>
            <Icon className={cn('h-3 w-3', tierInfo.color)} />
            <span className={tierInfo.color}>{tierInfo.label}</span>
          </Badge>
          <CardTitle className="text-xl">{plan.name || 'Untitled Plan'}</CardTitle>
          <CardDescription className="text-sm">{plan.description || 'No description'}</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={onCollapse} className="shrink-0">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
      </CardHeader>

      <CardContent className="grid md:grid-cols-2 gap-6">
        {/* Left: Features */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm text-muted-foreground">Features included</h4>
          <PlanSourceControlBadge plan={plan} />
          <div className="space-y-2">
            {(plan.features || []).map((feature, index) => (
              <div key={index} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Stats & Config */}
        <div className="space-y-4">
          {/* Quick stats */}
          {plan.config?.generatedPlan && (
            <div>
              <h4 className="font-medium text-sm text-muted-foreground mb-2">Project structure</h4>
              <div className="flex gap-6">
                {plan.config.generatedPlan.pages?.length > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-semibold">{plan.config.generatedPlan.pages.length}</p>
                    <p className="text-xs text-muted-foreground">Pages</p>
                  </div>
                )}
                {plan.config.generatedPlan.entities?.length > 0 && (
                  <div className="text-center">
                    <p className="text-2xl font-semibold">{plan.config.generatedPlan.entities.length}</p>
                    <p className="text-xs text-muted-foreground">Entities</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tech stack */}
          {plan.config?.stack && (
            <div>
              <h4 className="font-medium text-sm text-muted-foreground mb-2">Tech stack</h4>
              <div className="flex flex-wrap gap-2">
                <PlanSourceControlBadge plan={plan} />
                <Badge variant="secondary" className="capitalize">{plan.config.stack.backend}</Badge>
                <Badge variant="secondary" className="capitalize">{plan.config.stack.hosting}</Badge>
                {plan.config.stack.aiProvider && (
                  <Badge variant="secondary" className="capitalize">{plan.config.stack.aiProvider}</Badge>
                )}
              </div>
            </div>
          )}

          {/* Scope */}
          {plan.estimatedScope && (
            <div>
              <h4 className="font-medium text-sm text-muted-foreground mb-1">Estimated scope</h4>
              <p className="text-sm">{plan.estimatedScope}</p>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex gap-3">
        <Button
          variant={isSelected ? 'default' : 'outline'}
          className="flex-1"
          disabled={!isSelectable}
          onClick={onSelect}
        >
          {isSelected ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              Selected
            </>
          ) : (
            'Select this plan'
          )}
        </Button>
        {isSelected && (
          <Button
            onClick={onConfirm}
            disabled={isConfirming || !isSelectable}
            className="flex-1"
          >
            {isConfirming ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Starting build...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Build {tierInfo.label}
              </>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

// Legacy PlanCard export for backwards compatibility
interface PlanCardProps {
  plan: PlanOption
  isSelected: boolean
  isSelectable?: boolean
  onSelect: () => void
  className?: string
}

export function PlanCard({ plan, isSelected, isSelectable = true, onSelect, className }: PlanCardProps) {
  const normalizedTier = (plan.tier?.toLowerCase?.() || 'prototype') as keyof typeof tierConfig
  const tierInfo = tierConfig[normalizedTier] || tierConfig.prototype
  const Icon = tierInfo.icon

  return (
    <Card
      className={cn(
        'relative cursor-pointer transition-all duration-200',
        'rounded-[1.75rem] bg-muted/45 dark:bg-muted/25 shadow-none border-0',
        'hover:scale-[1.01] hover:bg-muted/55 dark:hover:bg-muted/30',
        isSelected && 'bg-muted/65 dark:bg-muted/35',
        !isSelectable && 'opacity-65',
        className
      )}
      onClick={onSelect}
    >
      {/* Tier badge */}
      <div className={cn('absolute -top-3 left-4')}>
        <Badge variant="outline" className={cn('gap-1', tierInfo.bgColor, tierInfo.borderColor)}>
          <Icon className={cn('h-3 w-3', tierInfo.color)} />
          <span className={tierInfo.color}>{tierInfo.label}</span>
        </Badge>
      </div>

      <CardHeader className="pt-6">
        <CardTitle className="text-lg">{plan.name || 'Untitled Plan'}</CardTitle>
        <CardDescription>{plan.description || 'No description'}</CardDescription>
        <div>
          <PlanSourceControlBadge plan={plan} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Features list */}
        <div className="space-y-2">
          {(plan.features || []).map((feature, index) => (
            <div key={index} className="flex items-start gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{feature}</span>
            </div>
          ))}
        </div>

        {/* Scope indicator */}
        {plan.estimatedScope && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Estimated scope: <span className="font-medium">{plan.estimatedScope}</span>
            </p>
          </div>
        )}

        {/* Quick stats from config */}
        {plan.config?.generatedPlan && (
          <div className="flex gap-4 pt-2 border-t">
            {plan.config.generatedPlan.pages?.length > 0 && (
              <div className="text-center">
                <p className="text-lg font-semibold">{plan.config.generatedPlan.pages.length}</p>
                <p className="text-xs text-muted-foreground">Pages</p>
              </div>
            )}
            {plan.config.generatedPlan.entities?.length > 0 && (
              <div className="text-center">
                <p className="text-lg font-semibold">{plan.config.generatedPlan.entities.length}</p>
                <p className="text-xs text-muted-foreground">Entities</p>
              </div>
            )}
            {plan.config?.stack?.backend && (
              <div className="text-center">
                <p className="text-lg font-semibold capitalize">{plan.config.stack.backend}</p>
                <p className="text-xs text-muted-foreground">Backend</p>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          variant={isSelected ? 'default' : 'outline'}
          className="w-full"
          disabled={!isSelectable}
          onClick={(e) => {
            e.stopPropagation()
            onSelect()
          }}
        >
          {isSelected ? (
            <>
              <Check className="h-4 w-4 mr-2" />
              Selected
            </>
          ) : (
            'Select this plan'
          )}
        </Button>
      </CardFooter>
    </Card>
  )
}

interface PlanSelectorProps {
  plans: PlanOption[]
  onSelect: (plan: PlanOption) => void
  className?: string
}

export function PlanSelector({ plans, onSelect, className }: PlanSelectorProps) {
  const [selectedTier, setSelectedTier] = useState<TierType | null>(null)
  const [expandedTier, setExpandedTier] = useState<TierType | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [selectionError, setSelectionError] = useState<string | null>(null)

  // Sort plans by tier order (handle invalid tiers gracefully)
  const sortedPlans = [...plans].sort((a, b) => {
    const order: Record<string, number> = { prototype: 0, beta: 1, mvp: 2 }
    const aTier = a.tier?.toLowerCase?.() || ''
    const bTier = b.tier?.toLowerCase?.() || ''
    return (order[aTier] ?? 99) - (order[bTier] ?? 99)
  })

  const selectedPlan = plans.find((p) => {
    const pTier = p.tier?.toLowerCase?.() || ''
    return pTier === selectedTier
  })

  const isPlanSelectable = (plan: PlanOption) => validateWebOnlyPlanConfig(plan.config).valid

  const expandedPlan = expandedTier
    ? plans.find((p) => p.tier?.toLowerCase?.() === expandedTier)
    : null

  const handleConfirm = async () => {
    if (!selectedPlan) return
    const validation = validateWebOnlyPlanConfig(selectedPlan.config)
    if (!validation.valid) {
      setSelectionError(validation.error ?? 'Current builder supports web projects only.')
      return
    }
    setIsConfirming(true)
    try {
      await onSelect(selectedPlan)
    } finally {
      setIsConfirming(false)
    }
  }

  const handleSelectInExpanded = () => {
    if (expandedTier) {
      const target = plans.find((p) => p.tier?.toLowerCase?.() === expandedTier)
      if (!target) return
      const validation = validateWebOnlyPlanConfig(target.config)
      if (!validation.valid) {
        setSelectionError(validation.error ?? 'Current builder supports web projects only.')
        return
      }
      setSelectionError(null)
      setSelectedTier(expandedTier)
    }
  }

  const handleSelectPlan = (plan: PlanOption, normalizedTier: TierType) => {
    const validation = validateWebOnlyPlanConfig(plan.config)
    if (!validation.valid) {
      setSelectionError(validation.error ?? 'Current builder supports web projects only.')
      return
    }

    setSelectionError(null)
    setSelectedTier(normalizedTier)
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-semibold">Choose Your Project Plan</h3>
        <p className="text-muted-foreground text-sm">
          Select the scope that best fits your needs. You can always expand later.
        </p>
      </div>

      <Alert>
        <AlertDescription>
          Current builder supports web projects only. Native desktop/mobile support will come in a future update.
        </AlertDescription>
      </Alert>

      {selectionError && (
        <Alert variant="destructive">
          <AlertDescription>{selectionError}</AlertDescription>
        </Alert>
      )}

      {/* Expanded view - single full-width card */}
      {expandedPlan ? (
        <ExpandedPlanCard
          plan={expandedPlan}
          isSelected={selectedTier === expandedTier}
          isSelectable={isPlanSelectable(expandedPlan)}
          onSelect={handleSelectInExpanded}
          onCollapse={() => setExpandedTier(null)}
          onConfirm={handleConfirm}
          isConfirming={isConfirming}
        />
      ) : (
        <>
          {/* Compact view - 3 square cards */}
          <div className="grid grid-cols-3 gap-4">
            {sortedPlans.map((plan, index) => {
              const normalizedTier = (plan.tier?.toLowerCase?.() || `plan-${index}`) as TierType
              return (
                <CompactPlanCard
                  key={`${normalizedTier}-${index}`}
                  plan={plan}
                  isSelected={selectedTier === normalizedTier}
                  isSelectable={isPlanSelectable(plan)}
                  onSelect={() => handleSelectPlan(plan, normalizedTier)}
                  onExpand={() => setExpandedTier(normalizedTier)}
                />
              )
            })}
          </div>

          {/* Confirm button - only in compact view when selected */}
          {selectedTier && (
            <div className="flex justify-center pt-4">
              <Button
                size="lg"
                onClick={handleConfirm}
                disabled={isConfirming}
                className="min-w-[200px]"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Starting build...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Build {tierConfig[selectedTier]?.label || 'Project'}
                  </>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
