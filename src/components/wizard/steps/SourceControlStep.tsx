import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { WizardSourceControl } from '@/hooks/useWizardState'

interface SourceControlStepProps {
  sourceControl: WizardSourceControl
  onUpdate: (sourceControl: Partial<WizardSourceControl>) => void
}

const GIT_PROVIDERS = [
  { id: 'github', name: 'GitHub', icon: '🐙' },
  { id: 'gitlab', name: 'GitLab', icon: '🦊' },
  { id: 'bitbucket', name: 'Bitbucket', icon: '🪣' },
  { id: 'local', name: 'Local Only', icon: '📁' },
]

const MERGE_STRATEGIES = [
  { id: 'squash', name: 'Squash', description: 'Combine into single commit' },
  { id: 'merge', name: 'Merge Commit', description: 'Preserve all commits' },
  { id: 'rebase', name: 'Rebase', description: 'Linear history' },
]

const MERGE_QUEUES = [
  { id: 'github', name: 'GitHub Queue' },
  { id: 'mergify', name: 'Mergify' },
  { id: 'none', name: 'None' },
]

export function SourceControlStep({ sourceControl, onUpdate }: SourceControlStepProps) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Source Control & CI/CD</h2>
        <p className="text-muted-foreground">
          Configure how your code is stored and deployed
        </p>
      </div>

      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Git Provider */}
        <div className="space-y-3">
          <Label>
            Git Provider <span className="text-destructive">*</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {GIT_PROVIDERS.map((option) => (
              <Badge
                key={option.id}
                variant={sourceControl.provider === option.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm"
                onClick={() => onUpdate({ provider: option.id })}
              >
                <span className="mr-1">{option.icon}</span>
                {option.name}
              </Badge>
            ))}
          </div>
        </div>

        {/* Repository Visibility */}
        <div className="space-y-3">
          <Label>Repository Visibility</Label>
          <RadioGroup
            value={sourceControl.visibility}
            onValueChange={(value) => onUpdate({ visibility: value })}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="public" id="public" />
              <Label htmlFor="public" className="font-normal cursor-pointer">
                Public
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="private" id="private" />
              <Label htmlFor="private" className="font-normal cursor-pointer">
                Private
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* Merge Strategy */}
        <div className="space-y-3">
          <Label>Merge Strategy</Label>
          <div className="grid grid-cols-3 gap-3">
            {MERGE_STRATEGIES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onUpdate({ mergeStrategy: option.id })}
                className={`p-3 rounded-lg border text-left transition-all ${
                  sourceControl.mergeStrategy === option.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <p className="font-medium text-sm">{option.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Merge Queue */}
        <div className="space-y-3">
          <Label>Merge Queue (optional)</Label>
          <div className="flex flex-wrap gap-2">
            {MERGE_QUEUES.map((option) => (
              <Badge
                key={option.id}
                variant={sourceControl.mergeQueue === option.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm"
                onClick={() => onUpdate({ mergeQueue: option.id })}
              >
                {option.name}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
