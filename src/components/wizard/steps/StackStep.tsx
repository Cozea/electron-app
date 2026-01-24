import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { WizardStack } from '@/hooks/useWizardState'

interface StackStepProps {
  stack: WizardStack
  onUpdate: (stack: Partial<WizardStack>) => void
}

const BACKEND_OPTIONS = [
  { id: 'supabase', name: 'Supabase', description: 'Auth + DB + Storage' },
  { id: 'convex', name: 'Convex', description: 'Real-time sync' },
  { id: 'firebase', name: 'Firebase', description: 'Google ecosystem' },
  { id: 'postgres', name: 'PostgreSQL', description: 'Self-hosted + Prisma' },
]

const HOSTING_OPTIONS = [
  { id: 'vercel', name: 'Vercel', icon: '▲' },
  { id: 'netlify', name: 'Netlify', icon: '◆' },
  { id: 'railway', name: 'Railway', icon: '🚂' },
  { id: 'aws', name: 'AWS Amplify', icon: '☁️' },
]

const AI_PROVIDER_OPTIONS = [
  { id: 'openai', name: 'OpenAI', icon: '🤖' },
  { id: 'anthropic', name: 'Anthropic', icon: '🧠' },
  { id: 'byok', name: 'BYOK', icon: '🔑' },
  { id: 'none', name: 'Skip', icon: '⏭️' },
]

export function StackStep({ stack, onUpdate }: StackStepProps) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Choose your tech stack</h2>
        <p className="text-muted-foreground">
          Select the technologies that power your project
        </p>
      </div>

      <div className="space-y-8 max-w-2xl mx-auto">
        {/* Backend / Database */}
        <div className="space-y-3">
          <Label>
            Backend / Database <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BACKEND_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onUpdate({ backend: option.id })}
                className={`p-4 rounded-lg border text-left transition-all ${
                  stack.backend === option.id
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

        {/* Hosting */}
        <div className="space-y-3">
          <Label>
            Hosting <span className="text-destructive">*</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {HOSTING_OPTIONS.map((option) => (
              <Badge
                key={option.id}
                variant={stack.hosting === option.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm"
                onClick={() => onUpdate({ hosting: option.id })}
              >
                <span className="mr-1">{option.icon}</span>
                {option.name}
              </Badge>
            ))}
          </div>
        </div>

        {/* AI Provider */}
        <div className="space-y-3">
          <Label>AI Provider (optional)</Label>
          <div className="flex flex-wrap gap-2">
            {AI_PROVIDER_OPTIONS.map((option) => (
              <Badge
                key={option.id}
                variant={stack.aiProvider === option.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm"
                onClick={() => onUpdate({ aiProvider: option.id })}
              >
                <span className="mr-1">{option.icon}</span>
                {option.name}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            If your app needs AI capabilities, select a provider
          </p>
        </div>
      </div>
    </div>
  )
}
