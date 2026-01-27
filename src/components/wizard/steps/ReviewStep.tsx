import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import type { WizardState } from '@/hooks/useWizardState'

interface ReviewStepProps {
  state: WizardState
  onEditStep: (step: number) => void
}

export function ReviewStep({ state, onEditStep }: ReviewStepProps) {
  return (
    <div className="space-y-8">


      <div className="space-y-4 max-w-2xl">
        {/* Project Info */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Project</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => onEditStep(1)}>
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="font-medium">{state.intent.name || 'Untitled Project'}</p>
              <p className="text-sm text-muted-foreground">
                {state.intent.description || 'No description'}
              </p>
            </div>
            {state.template && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Template:</span>
                <Badge variant="secondary">{state.template}</Badge>
              </div>
            )}
            {state.intent.audience && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Target:</span>
                <span className="text-sm">{state.intent.audience}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tech Stack */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Tech Stack</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => onEditStep(3)}>
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{state.stack.backend}</Badge>
              <Badge variant="secondary">{state.stack.hosting}</Badge>
              {state.stack.aiProvider && state.stack.aiProvider !== 'none' && (
                <Badge variant="secondary">{state.stack.aiProvider}</Badge>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Git: {state.sourceControl.provider}</span>
              <span>•</span>
              <span>{state.sourceControl.visibility}</span>
              <span>•</span>
              <span>{state.sourceControl.mergeStrategy} merge</span>
            </div>
          </CardContent>
        </Card>

        {/* Visuals */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Visuals</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => onEditStep(5)}>
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">UI:</span>
                <Badge variant="secondary">{state.visuals.uiLibrary}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Theme:</span>
                <div className="flex gap-1">
                  <div
                    className="w-5 h-5 rounded-full border"
                    style={{ backgroundColor: state.visuals.primaryColor }}
                  />
                  <div
                    className="w-5 h-5 rounded-full border"
                    style={{ backgroundColor: state.visuals.secondaryColor }}
                  />
                  <div
                    className="w-5 h-5 rounded-full border"
                    style={{ backgroundColor: state.visuals.accentColor }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Team</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => onEditStep(6)}>
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {state.team.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {state.team.map((member) => (
                  <Badge key={member.email} variant="outline">
                    {member.name || member.email}
                    <span className="ml-1 text-muted-foreground">
                      ({member.role.replace('_', ' ')})
                    </span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No team members added</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          💡 Click "Generate Plan" to have AI create your project structure
        </p>
      </div>
    </div>
  )
}
