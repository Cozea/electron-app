import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { WizardStepDef } from '@/hooks/useWizardState'

interface WizardLayoutProps {
  children: ReactNode
  steps: WizardStepDef[]
  currentStep: number
  title?: string
  fullHeight?: boolean
  preserveInsetInFullHeight?: boolean
  showInternalStepHeader?: boolean
  // Navigation props formerly used by sidebar, kept optional for compatibility if needed elsewhere
  onStepClick?: (step: number) => void
  canNavigateToStep?: (step: number) => boolean
}

export function WizardLayout({
  children,
  steps,
  currentStep,
  title = 'New Project',
  fullHeight = false,
  preserveInsetInFullHeight = false,
  showInternalStepHeader = false,
}: WizardLayoutProps) {
  const isEntryStep = currentStep === 0
  // Current step index (0-based)
  // Step 0 is entry, so "Step 1" for user is actually step index 1
  const effectiveStepIndex = currentStep
  const totalSteps = steps.length - 1 // Exclude entry step from total count if typically 0 is entry

  // Calculate progress percentage for the bar
  // If currentStep is 0 (Entry), progress is 0. If currentStep is 1, progress is 1/total
  const progressPercent = Math.min(100, Math.max(0, (effectiveStepIndex / totalSteps) * 100))

  return (
    <div className={cn(
      "flex flex-col -m-4",
      fullHeight
        ? preserveInsetInFullHeight
          ? "h-full min-h-0"
          : "h-[calc(100vh-56px)]"
        : "min-h-[calc(100vh-56px)]"
    )}>
      {!fullHeight && showInternalStepHeader && currentStep > 0 && (
        <div className="w-full sticky top-0 z-40 bg-background/80 backdrop-blur-sm bdry-b">
          <div className="w-full px-8 py-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Step {currentStep} of {totalSteps}
              </span>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                {steps[currentStep]?.title || title}
              </h1>
            </div>
            {/* Simple numeric indicator or small circular progress could go here if needed */}
          </div>
          {/* Progress Line */}
          <div className="h-0.5 w-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className={cn(
        "flex-1 w-full flex flex-col",
        fullHeight && "min-h-0"
      )}>
        <div className={cn(
          "flex-1 w-full px-8 py-8 flex flex-col min-h-0",
          fullHeight
            ? preserveInsetInFullHeight
              ? "max-w-full min-h-0"
              : "max-w-full p-0 min-h-0"
            :
            currentStep === 0 ? "max-w-2xl mx-auto justify-center" : ""
        )}>
          {fullHeight ? (
            // No animation wrapper in fullHeight mode to preserve flex layout
            children
          ) : (
            <div
              key={currentStep}
              className={cn(
                "w-full flex flex-col min-h-0 animate-in fade-in slide-in-from-bottom-2 duration-300",
                // Entry step wants to be vertically centered via the parent container's `justify-center`.
                // Don't force the motion wrapper to consume all vertical space.
                !isEntryStep && "flex-1"
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
