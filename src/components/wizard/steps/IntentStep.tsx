import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'
import type { WizardIntent } from '@/hooks/useWizardState'

interface IntentStepProps {
  intent: WizardIntent
  onUpdate: (intent: Partial<WizardIntent>) => void
}

export function IntentStep({ intent, onUpdate }: IntentStepProps) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">What are you building?</h2>
        <p className="text-muted-foreground">Tell us about your project</p>
      </div>

      <div className="space-y-6 max-w-xl mx-auto">
        <div className="space-y-2">
          <Label htmlFor="name">
            Project Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="name"
            placeholder="My Awesome App"
            value={intent.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">
            Description <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="description"
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Describe your project in a few sentences. What problem does it solve? What features should it have?"
            value={intent.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
          />
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Enhance with AI
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="audience">Who is this for?</Label>
          <Input
            id="audience"
            placeholder="e.g., Small business owners, developers, students..."
            value={intent.audience}
            onChange={(e) => onUpdate({ audience: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="launchDate">Target Launch Date (optional)</Label>
          <Input
            id="launchDate"
            type="date"
            value={
              intent.targetLaunchDate
                ? new Date(intent.targetLaunchDate).toISOString().split('T')[0]
                : ''
            }
            onChange={(e) =>
              onUpdate({
                targetLaunchDate: e.target.value ? new Date(e.target.value).getTime() : undefined,
              })
            }
          />
        </div>
      </div>
    </div>
  )
}
