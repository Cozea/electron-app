import type { ReactNode } from 'react'
import { TitleBar } from '../TitleBar'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { cn } from '@/lib/utils'
import { Check, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'

export interface OnboardingStep {
  id: string
  title: string
  optional?: boolean
}

interface OnboardingLayoutProps {
  // Steps
  steps: OnboardingStep[]
  currentStep: number

  // Content
  title: string
  description?: string
  children: ReactNode

  // Navigation
  onBack?: () => void
  onNext?: () => void
  onSkip?: () => void

  // State
  isLoading?: boolean
  canGoBack?: boolean
  canGoNext?: boolean
  canSkip?: boolean

  // Labels
  nextLabel?: string
  skipLabel?: string
}

export function OnboardingLayout({
  steps,
  currentStep,
  title,
  description,
  children,
  onBack,
  onNext,
  onSkip,
  isLoading = false,
  canGoBack = true,
  canGoNext = true,
  canSkip = false,
  nextLabel = 'Continue',
  skipLabel = 'Skip for now',
}: OnboardingLayoutProps) {
  const isFirstStep = currentStep === 0

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden mt-10">
        {/* Steps List */}
        <aside className="w-72 border-r border-border flex flex-col bg-muted/30">
          <div className="p-6">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg mb-4">
              C
            </div>
            <h2 className="font-semibold text-lg">Welcome to Cozea</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Let's get you set up
            </p>
          </div>

          <ScrollArea className="flex-1">
            <nav className="px-4 pb-4 space-y-1">
              {steps.map((step, index) => (
                <OnboardingStepItem
                  key={step.id}
                  step={step}
                  index={index}
                  currentStep={currentStep}
                />
              ))}
            </nav>
          </ScrollArea>
        </aside>

        {/* Content Panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content Header */}
          <header className="px-10 py-8">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {description && (
              <p className="text-muted-foreground mt-2 max-w-lg">
                {description}
              </p>
            )}
          </header>

          {/* Content Body */}
          <ScrollArea className="flex-1">
            <div className="px-10 pb-10">
              {children}
            </div>
          </ScrollArea>

          {/* Footer */}
          <footer className="px-10 py-6 border-t border-border flex items-center justify-between">
            <div>
              {!isFirstStep && (
                <Button
                  variant="ghost"
                  onClick={onBack}
                  disabled={!canGoBack || isLoading}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {canSkip && (
                <Button
                  variant="ghost"
                  onClick={onSkip}
                  disabled={isLoading}
                  className="text-muted-foreground"
                >
                  {skipLabel}
                </Button>
              )}
              <Button
                onClick={onNext}
                disabled={!canGoNext || isLoading}
                className="gap-2"
              >
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {nextLabel}
                {!isLoading && <ArrowRight className="h-4 w-4" />}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

function OnboardingStepItem({
  step,
  index,
  currentStep,
}: {
  step: OnboardingStep
  index: number
  currentStep: number
}) {
  const isCompleted = index < currentStep
  const isCurrent = index === currentStep
  const isPending = index > currentStep

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg transition-colors',
        isCurrent && 'bg-accent',
        isPending && 'opacity-50'
      )}
    >
      <div
        className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
          isCompleted && 'bg-primary text-primary-foreground',
          isCurrent && 'border-2 border-primary text-primary',
          isPending && 'border border-muted-foreground/50 text-muted-foreground'
        )}
      >
        {isCompleted ? <Check className="h-3 w-3" /> : index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium',
          isPending && 'text-muted-foreground'
        )}>
          {step.title}
        </p>
        {step.optional && (
          <p className="text-xs text-muted-foreground">Optional</p>
        )}
      </div>
    </div>
  )
}
