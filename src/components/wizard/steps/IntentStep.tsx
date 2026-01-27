import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles, Calendar as CalendarIcon } from 'lucide-react'
import type { WizardIntent } from '@/hooks/useWizardState'

interface IntentStepProps {
  intent: WizardIntent
  onUpdate: (intent: Partial<WizardIntent>) => void
}

export function IntentStep({ intent, onUpdate }: IntentStepProps) {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">


      <div className="space-y-8 max-w-lg">
        <div className="grid gap-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base font-medium">
              Project Name
            </Label>
            <Input
              id="name"
              placeholder="e.g. Acme Dashboard"
              value={intent.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="h-12 text-lg bg-muted/30 border-muted/60 focus:bg-background transition-colors"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-base font-medium">
              Description
            </Label>
            <div className="relative">
              <Textarea
                id="description"
                className="min-h-[160px] resize-none text-base bg-muted/30 border-muted/60 focus:bg-background transition-colors p-4"
                placeholder="Describe your project... What does it do? Who is it for?"
                value={intent.description}
                onChange={(e) => onUpdate({ description: e.target.value })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-3 right-3 gap-2 text-xs text-muted-foreground hover:text-primary z-10"
              >
                <Sparkles className="h-3 w-3" />
                Rewrite with AI
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="audience" className="text-base font-medium">Target Audience</Label>
              <Input
                id="audience"
                placeholder="e.g. Developers"
                value={intent.audience}
                onChange={(e) => onUpdate({ audience: e.target.value })}
                className="h-11 bg-muted/30 border-muted/60 focus:bg-background transition-colors"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="launchDate" className="text-base font-medium">Launch Date</Label>
              <div className="relative">
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
                  className="h-11 bg-muted/30 border-muted/60 focus:bg-background transition-colors pl-10"
                />
                <CalendarIcon className="absolute left-3 top-3 h-5 w-5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-base font-medium">What does success look like?</Label>
            <Select
              value={intent.successCriteria || ''}
              onValueChange={(value) => onUpdate({ successCriteria: value as any })}
            >
              <SelectTrigger className="h-11 bg-muted/30 border-muted/60 focus:bg-background transition-colors">
                <SelectValue placeholder="Select success criteria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="working_feature">
                  <div className="flex flex-col">
                    <span>Working Feature</span>
                    <span className="text-xs text-muted-foreground">Core logic & efficiency over pixel-perfect UI</span>
                  </div>
                </SelectItem>
                <SelectItem value="mvp_launch">
                  <div className="flex flex-col">
                    <span>MVP Launch</span>
                    <span className="text-xs text-muted-foreground">Speed to market & essential features</span>
                  </div>
                </SelectItem>
                <SelectItem value="production_ready">
                  <div className="flex flex-col">
                    <span>Production Ready</span>
                    <span className="text-xs text-muted-foreground">Scalability, security & testing</span>
                  </div>
                </SelectItem>
                <SelectItem value="internal_tool">
                  <div className="flex flex-col">
                    <span>Internal Tool</span>
                    <span className="text-xs text-muted-foreground">Functionality & data handling</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
