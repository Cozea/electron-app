import { Label } from '@/components/ui/label'
import type { WizardStack } from '@/hooks/useWizardState'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface StackStepProps {
  stack: WizardStack
  onUpdate: (stack: Partial<WizardStack>) => void
}

const BACKEND_OPTIONS = [
  { id: 'supabase', name: 'Supabase', description: 'Auth + DB + Storage' },
  { id: 'firebase', name: 'Firebase', description: 'Google ecosystem' },
  { id: 'convex', name: 'Convex', description: 'Real-time sync' },
  { id: 'appwrite', name: 'Appwrite', description: 'Open source backend' },
  { id: 'postgres', name: 'PostgreSQL', description: 'Self-hosted + Prisma' },
  { id: 'none', name: 'None', description: 'Custom backend' },
]

const HOSTING_OPTIONS = [
  { id: 'vercel', name: 'Vercel', icon: '▲', description: 'Zero-config deployment' },
  { id: 'netlify', name: 'Netlify', icon: '◆', description: 'Global edge network' },
  { id: 'firebase', name: 'Firebase', icon: '🔥', description: 'Fast CDN + Hosting' },
  { id: 'railway', name: 'Railway', icon: '🚂', description: 'Infrastructure platform' },
  { id: 'fly', name: 'Fly.io', icon: '✈️', description: 'Global application platform' },
  { id: 'aws', name: 'AWS Amplify', icon: '☁️', description: 'Full-stack AWS' },
  { id: 'none', name: 'None', icon: '🚫', description: 'Self-hosted' },
]

const AI_PROVIDER_OPTIONS = [
  { id: 'openai', name: 'OpenAI', icon: '🤖', description: 'GPT-4 & DALL-E' },
  { id: 'google', name: 'Google AI', icon: '🔍', description: 'Gemini models' },
  { id: 'none', name: 'No AI', icon: '🚫', description: 'Standard application' },
  { id: 'byok', name: 'BYOK', icon: '🔑', description: 'Bring your own keys' },
]

export function StackStep({ stack, onUpdate }: StackStepProps) {
  return (
    <div
      className="space-y-12 animate-in fade-in slide-in-from-bottom-2 duration-300"
    >


      <div className="space-y-10 max-w-4xl">
        {/* Backend / Database */}
        <div className="space-y-4">
          <Label className="text-base font-medium flex items-center gap-2">
            Backend & Database <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {BACKEND_OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                title={option.name}
                description={option.description}
                selected={stack.backend === option.id}
                onClick={() => onUpdate({ backend: option.id })}
              />
            ))}
          </div>
        </div>

        {/* Hosting */}
        <div className="space-y-4">
          <Label className="text-base font-medium flex items-center gap-2">
            Hosting Provider <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {HOSTING_OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                icon={option.icon}
                title={option.name}
                description={option.description}
                selected={stack.hosting === option.id}
                onClick={() => onUpdate({ hosting: option.id })}
              />
            ))}
          </div>
        </div>

        {/* AI Provider */}
        <div className="space-y-4">
          <Label className="text-base font-medium flex items-center gap-2">
            AI Capabilities <span className="text-muted-foreground font-normal text-sm ml-auto">(Optional)</span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {AI_PROVIDER_OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                icon={option.icon}
                title={option.name}
                description={option.description}
                selected={stack.aiProvider === option.id}
                onClick={() => onUpdate({ aiProvider: option.id })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function OptionCard({
  icon,
  title,
  description,
  selected,
  onClick
}: {
  icon?: string,
  title: string,
  description: string,
  selected: boolean,
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-start text-left p-5 h-full rounded-xl border-2 outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-muted bg-card hover:border-primary/50 hover:bg-accent/50"
      )}
    >
      {selected && (
        <div className="absolute top-3 right-3 text-primary">
          <div className="bg-primary text-primary-foreground rounded-full p-0.5">
            <Check className="w-3 h-3" strokeWidth={3} />
          </div>
        </div>
      )}

      {icon && <span className="text-2xl mb-3 block">{icon}</span>}
      <p className={cn("font-semibold text-sm", selected ? "text-primary" : "text-foreground")}>
        {title}
      </p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
        {description}
      </p>
    </button>
  )
}
