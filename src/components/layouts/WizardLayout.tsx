import type { ReactNode } from 'react'
import { TitleBar } from '../TitleBar'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '@/lib/utils'
import { Check, Circle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'

export interface WizardStep {
  id: string
  title: string
  description?: string
}

interface WizardLayoutProps {
  // Steps
  steps: WizardStep[]
  currentStep: number

  // Content
  children: ReactNode
  helperPanel?: ReactNode

  // Navigation
  onBack?: () => void
  onNext?: () => void
  onComplete?: () => void

  // State
  isLoading?: boolean
  canGoBack?: boolean
  canGoNext?: boolean

  // Labels
  nextLabel?: string
  backLabel?: string
  completeLabel?: string
}

export function WizardLayout({
  steps,
  currentStep,
  children,
  helperPanel,
  onBack,
  onNext,
  onComplete,
  isLoading = false,
  canGoBack = true,
  canGoNext = true,
  nextLabel = 'Continue',
  backLabel = 'Back',
  completeLabel = 'Complete',
}: WizardLayoutProps) {
  const isLastStep = currentStep === steps.length - 1
  const currentStepData = steps[currentStep]

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar showTitle title="Vibe Wizard" />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden mt-10">
        {/* Steps Rail */}
        <aside className="w-64 bdry-r flex flex-col bg-muted/30">
          <div className="p-4 bdry-b">
            <h2 className="font-semibold">Setup Wizard</h2>
            <p className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </p>
          </div>

          <ScrollArea className="flex-1">
            <nav className="p-4 space-y-1">
              {steps.map((step, index) => (
                <StepItem
                  key={step.id}
                  step={step}
                  index={index}
                  currentStep={currentStep}
                />
              ))}
            </nav>
          </ScrollArea>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Step Header */}
          <header className="px-8 py-6 bdry-b">
            <h1 className="text-2xl font-semibold">{currentStepData?.title}</h1>
            {currentStepData?.description && (
              <p className="text-muted-foreground mt-1">
                {currentStepData.description}
              </p>
            )}
          </header>

          {/* Step Content */}
          <div className="flex-1 flex overflow-hidden">
            <ScrollArea className="flex-1">
              <div className="p-8">
                {children}
              </div>
            </ScrollArea>

            {/* Helper Panel (optional) */}
            {helperPanel && (
              <aside className="w-80 bdry-l bg-muted/30">
                <div className="p-4 bdry-b">
                  <h3 className="font-medium text-sm">Help</h3>
                </div>
                <ScrollArea className="h-full">
                  <div className="p-4">
                    {helperPanel}
                  </div>
                </ScrollArea>
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="h-16 bdry-t flex items-center justify-between px-8 bg-background">
        <div>
          {currentStep > 0 && (
            <Button
              variant="ghost"
              onClick={onBack}
              disabled={!canGoBack || isLoading}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, index) => (
              <div
                key={index}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  index === currentStep
                    ? 'bg-primary'
                    : index < currentStep
                    ? 'bg-primary/50'
                    : 'bg-muted-foreground/30'
                )}
              />
            ))}
          </div>
        </div>

        <div>
          <Button
            onClick={isLastStep ? onComplete : onNext}
            disabled={!canGoNext || isLoading}
            className="gap-2"
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLastStep ? completeLabel : nextLabel}
            {!isLastStep && !isLoading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function StepItem({
  step,
  index,
  currentStep,
}: {
  step: WizardStep
  index: number
  currentStep: number
}) {
  const isCompleted = index < currentStep
  const isCurrent = index === currentStep
  const isPending = index > currentStep

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-2 rounded-md transition-colors',
        isCurrent && 'bg-accent',
        isPending && 'opacity-50'
      )}
    >
      <div
        className={cn(
          'mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs',
          isCompleted && 'bg-primary text-primary-foreground',
          isCurrent && 'border-2 border-primary',
          isPending && 'border border-muted-foreground'
        )}
      >
        {isCompleted ? (
          <Check className="h-3 w-3" />
        ) : isCurrent ? (
          <Circle className="h-2 w-2 fill-current text-primary" />
        ) : (
          <span className="text-muted-foreground">{index + 1}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium truncate',
          isPending && 'text-muted-foreground'
        )}>
          {step.title}
        </p>
        {step.description && (
          <p className="text-xs text-muted-foreground truncate">
            {step.description}
          </p>
        )}
      </div>
    </div>
  )
}
