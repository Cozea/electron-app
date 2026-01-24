import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WizardStepDef } from '@/hooks/useWizardState'

interface WizardLayoutProps {
  children: ReactNode
  steps: WizardStepDef[]
  currentStep: number
  title?: string
  onStepClick?: (step: number) => void
  canNavigateToStep?: (step: number) => boolean
  fullHeight?: boolean // For conversation mode - fills available space
}

export function WizardLayout({
  children,
  steps,
  currentStep,
  title = 'New Project',
  onStepClick,
  canNavigateToStep,
  fullHeight = false,
}: WizardLayoutProps) {
  // Skip the entry step (index 0) in the sidebar
  const sidebarSteps = steps.slice(1)

  const showSidebar = currentStep > 0

  return (
    <div className={cn(
      "flex -m-4",
      fullHeight ? "h-[calc(100vh-56px)]" : "min-h-[calc(100vh-56px)]"
    )}>
      {/* Secondary Sidebar for Steps */}
      {showSidebar && (
      <div className="w-56 border-r bg-muted/30 flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b shrink-0">
          <h1 className="text-base font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step {currentStep} of {steps.length - 1}
          </p>
        </div>

        {/* Step Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto">
          <ul className="space-y-0.5">
            {sidebarSteps.map((step, index) => {
              const stepIndex = index + 1 // Account for skipped entry step
              const isActive = stepIndex === currentStep
              const isCompleted = stepIndex < currentStep
              const isFuture = stepIndex > currentStep
              const canNavigate = canNavigateToStep ? canNavigateToStep(stepIndex) : isCompleted

              return (
                <li key={step.id}>
                  <button
                    onClick={() => canNavigate && onStepClick?.(stepIndex)}
                    disabled={!canNavigate && !isActive}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors',
                      isActive && 'bg-primary text-primary-foreground',
                      isCompleted && !isActive && 'text-foreground hover:bg-muted cursor-pointer',
                      isFuture && 'text-muted-foreground/50 cursor-not-allowed'
                    )}
                  >
                    {/* Step indicator */}
                    <div
                      className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0',
                        isActive && 'bg-primary-foreground/20 text-primary-foreground',
                        isCompleted && !isActive && 'bg-primary/20 text-primary',
                        isFuture && 'bg-muted text-muted-foreground/50'
                      )}
                    >
                      {isCompleted && !isActive ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <step.icon className="h-3 w-3" />
                      )}
                    </div>

                    {/* Step info */}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-sm font-medium truncate',
                          isFuture && 'text-muted-foreground/50'
                        )}
                      >
                        {step.title}
                      </p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
      )}

      {/* Main Content */}
      <div className={cn(
        "flex-1",
        !fullHeight && "overflow-auto",
        fullHeight && "flex flex-col overflow-hidden",
        !showSidebar && !fullHeight && "flex items-center justify-center"
      )}>
        <div className={cn(
          "p-6 mx-auto",
          fullHeight && "flex-1 flex flex-col min-h-0",
          showSidebar ? "w-full max-w-4xl" : "w-full max-w-3xl"
        )}>{children}</div>
      </div>
    </div>
  )
}
