import type { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { WizardStepDef } from '@/hooks/useWizardState'

interface WizardLayoutProps {
  children: ReactNode
  steps: WizardStepDef[]
  currentStep: number
  title?: string
  fullHeight?: boolean
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
}: WizardLayoutProps) {
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
      fullHeight ? "h-[calc(100vh-56px)]" : "min-h-[calc(100vh-56px)]"
    )}>
      {!fullHeight && currentStep > 0 && (
        <div className="w-full sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b">
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
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
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
          "flex-1 w-full px-8 py-8 flex flex-col",
          fullHeight ? "max-w-full p-0 min-h-0" :
            currentStep === 0 ? "max-w-2xl mx-auto justify-center" : ""
        )}>
          {fullHeight ? (
            // No animation wrapper in fullHeight mode to preserve flex layout
            children
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="w-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  )
}
