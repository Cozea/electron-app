import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

interface PromptInputProps {
  value: string
  onChange: (value: string) => void
  reviewBeforeBuild: boolean
  setReviewBeforeBuild: (value: boolean) => void
  customizeTeam: boolean
  setCustomizeTeam: (value: boolean) => void
  allowCustomizeTeam?: boolean
}

export function PromptInput({
  value,
  onChange,
  reviewBeforeBuild,
  setReviewBeforeBuild,
  customizeTeam,
  setCustomizeTeam,
  allowCustomizeTeam = true,
}: PromptInputProps) {
  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">⚡ Quick Create</h2>
        <p className="text-muted-foreground">
          Just describe what you want to build
        </p>
      </div>

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="space-y-2">
          <Label htmlFor="prompt">Describe your project</Label>
          <textarea
            id="prompt"
            className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Build me a project management app like Asana but simpler. It should have:
- User authentication with Google
- Workspaces for different teams
- Kanban boards with drag and drop
- Task assignments and due dates
- Real-time updates when teammates make changes

Use Supabase for the backend and make it look modern with a dark theme option."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <p className="text-xs font-medium">💡 Tips for better results:</p>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Mention specific features you need</li>
            <li>• Specify preferred tech stack (or let AI choose)</li>
            <li>• Describe the visual style you want</li>
            <li>• Include any integrations (Stripe, Slack, etc.)</li>
          </ul>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="review"
              checked={reviewBeforeBuild}
              onCheckedChange={(checked) => setReviewBeforeBuild(checked as boolean)}
            />
            <Label htmlFor="review" className="text-sm font-normal cursor-pointer">
              Let me review the plan before building
            </Label>
          </div>
          {allowCustomizeTeam && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="team"
                checked={customizeTeam}
                onCheckedChange={(checked) => setCustomizeTeam(checked as boolean)}
              />
              <Label htmlFor="team" className="text-sm font-normal cursor-pointer">
                I want to customize team members
              </Label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
