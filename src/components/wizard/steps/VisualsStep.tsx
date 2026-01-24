import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Sparkles, Upload } from 'lucide-react'
import type { WizardVisuals } from '@/hooks/useWizardState'

interface VisualsStepProps {
  visuals: WizardVisuals
  onUpdate: (visuals: Partial<WizardVisuals>) => void
}

const UI_LIBRARIES = [
  { id: 'shadcn', name: 'shadcn/ui', icon: '🎨' },
  { id: 'radix', name: 'Radix UI', icon: '🎯' },
  { id: 'material', name: 'Material UI', icon: '💅' },
  { id: 'chakra', name: 'Chakra UI', icon: '🌊' },
]

const COLOR_PRESETS = [
  { name: 'Ocean', primary: '#3B82F6', secondary: '#1E40AF', accent: '#60A5FA' },
  { name: 'Sunset', primary: '#F97316', secondary: '#C2410C', accent: '#FDBA74' },
  { name: 'Forest', primary: '#22C55E', secondary: '#15803D', accent: '#86EFAC' },
  { name: 'Midnight', primary: '#8B5CF6', secondary: '#6D28D9', accent: '#C4B5FD' },
]

export function VisualsStep({ visuals, onUpdate }: VisualsStepProps) {
  const [isGenerating, setIsGenerating] = useState(false)

  const handleGeneratePresets = async () => {
    if (!visuals.vibeDescription) return
    setIsGenerating(true)
    // TODO: Implement AI color preset generation
    setTimeout(() => setIsGenerating(false), 1500)
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Visual Style & Branding</h2>
        <p className="text-muted-foreground">Customize the look and feel of your project</p>
      </div>

      <div className="space-y-8 max-w-2xl mx-auto">
        {/* UI Component Library */}
        <div className="space-y-3">
          <Label>
            UI Component Library <span className="text-destructive">*</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {UI_LIBRARIES.map((option) => (
              <Badge
                key={option.id}
                variant={visuals.uiLibrary === option.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm"
                onClick={() => onUpdate({ uiLibrary: option.id })}
              >
                <span className="mr-1">{option.icon}</span>
                {option.name}
              </Badge>
            ))}
          </div>
        </div>

        {/* Vibe Description */}
        <div className="space-y-3">
          <Label htmlFor="vibe">Describe the vibe</Label>
          <textarea
            id="vibe"
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            placeholder="Modern, clean, minimal with subtle gradients and rounded corners. Professional but approachable."
            value={visuals.vibeDescription}
            onChange={(e) => onUpdate({ vibeDescription: e.target.value })}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleGeneratePresets}
            disabled={!visuals.vibeDescription || isGenerating}
          >
            <Sparkles className="h-4 w-4" />
            {isGenerating ? 'Generating...' : 'Generate Color Presets'}
          </Button>
        </div>

        {/* Color Palette */}
        <div className="space-y-3">
          <Label>Color Palette</Label>
          <div className="space-y-4">
            {/* Presets */}
            <div className="grid grid-cols-4 gap-3">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() =>
                    onUpdate({
                      colorPreset: preset.name,
                      primaryColor: preset.primary,
                      secondaryColor: preset.secondary,
                      accentColor: preset.accent,
                    })
                  }
                  className={`p-3 rounded-lg border text-center transition-all ${
                    visuals.colorPreset === preset.name
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex justify-center gap-1 mb-2">
                    <div
                      className="w-5 h-5 rounded-full"
                      style={{ backgroundColor: preset.primary }}
                    />
                    <div
                      className="w-5 h-5 rounded-full"
                      style={{ backgroundColor: preset.secondary }}
                    />
                    <div
                      className="w-5 h-5 rounded-full"
                      style={{ backgroundColor: preset.accent }}
                    />
                  </div>
                  <p className="text-xs font-medium">{preset.name}</p>
                </button>
              ))}
            </div>

            {/* Manual color pickers */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Primary</Label>
                <div className="flex gap-2">
                  <div
                    className="w-10 h-10 rounded border cursor-pointer"
                    style={{ backgroundColor: visuals.primaryColor }}
                  />
                  <Input
                    type="text"
                    value={visuals.primaryColor}
                    onChange={(e) => onUpdate({ primaryColor: e.target.value })}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Secondary</Label>
                <div className="flex gap-2">
                  <div
                    className="w-10 h-10 rounded border cursor-pointer"
                    style={{ backgroundColor: visuals.secondaryColor }}
                  />
                  <Input
                    type="text"
                    value={visuals.secondaryColor}
                    onChange={(e) => onUpdate({ secondaryColor: e.target.value })}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Accent</Label>
                <div className="flex gap-2">
                  <div
                    className="w-10 h-10 rounded border cursor-pointer"
                    style={{ backgroundColor: visuals.accentColor }}
                  />
                  <Input
                    type="text"
                    value={visuals.accentColor}
                    onChange={(e) => onUpdate({ accentColor: e.target.value })}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Logo Upload */}
        <div className="space-y-3">
          <Label>Logo (optional)</Label>
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag & drop a logo or{' '}
                <button type="button" className="text-primary hover:underline">
                  browse
                </button>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
