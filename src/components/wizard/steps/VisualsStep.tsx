import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sparkles, Upload, Check } from 'lucide-react'
import type { WizardVisuals } from '@/hooks/useWizardState'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface VisualsStepProps {
  visuals: WizardVisuals
  onUpdate: (visuals: Partial<WizardVisuals>) => void
}

const UI_LIBRARIES = [
  { id: 'shadcn', name: 'shadcn/ui', icon: '🎨', description: 'Re-usable components' },
  { id: 'radix', name: 'Radix UI', icon: '🎯', description: 'Unstyled primitives' },
  { id: 'material', name: 'Material UI', icon: '💅', description: 'Google Design' },
  { id: 'chakra', name: 'Chakra UI', icon: '🌊', description: 'Simple & Modular' },
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
    setTimeout(() => setIsGenerating(false), 1500)
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="space-y-12"
    >


      <div className="space-y-12 max-w-4xl mx-auto">
        {/* UI Component Library */}
        <div className="space-y-4">
          <Label className="text-base font-medium flex items-center gap-2">
            UI Component Library <span className="text-destructive">*</span>
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {UI_LIBRARIES.map((option) => (
              <OptionCard
                key={option.id}
                icon={option.icon}
                title={option.name}
                description={option.description}
                selected={visuals.uiLibrary === option.id}
                onClick={() => onUpdate({ uiLibrary: option.id })}
                variants={item}
              />
            ))}
          </div>
        </div>

        {/* Vibe & Colors */}
        <div className="grid md:grid-cols-2 gap-10">
          {/* Vibe Description */}
          <div className="space-y-4">
            <Label htmlFor="vibe" className="text-base font-medium">Describe the vibe</Label>
            <div className="relative">
              <textarea
                id="vibe"
                className="flex min-h-[140px] w-full rounded-xl border border-input bg-muted/30 px-4 py-3 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none transition-colors focus:bg-background"
                placeholder="Modern, clean, minimal with subtle gradients and rounded corners..."
                value={visuals.vibeDescription}
                onChange={(e) => onUpdate({ vibeDescription: e.target.value })}
              />
              <Button
                variant="ghost"
                size="sm"
                className="absolute bottom-3 right-3 gap-2 text-xs text-muted-foreground hover:text-primary z-10"
                onClick={handleGeneratePresets}
                disabled={!visuals.vibeDescription || isGenerating}
              >
                <Sparkles className="h-3 w-3" />
                {isGenerating ? 'Generating...' : 'Enhance Vibe'}
              </Button>
            </div>
          </div>

          {/* Color Palette */}
          <div className="space-y-4">
            <Label className="text-base font-medium">Color Palette</Label>
            <div className="grid grid-cols-2 gap-3">
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
                  className={cn(
                    "p-3 rounded-xl border text-center transition-all duration-200 outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 relative",
                    visuals.colorPreset === preset.name
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/50 hover:bg-accent/50"
                  )}
                >
                  {visuals.colorPreset === preset.name && (
                    <div className="absolute top-2 right-2 text-primary">
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </div>
                  )}
                  <div className="flex justify-center gap-1.5 mb-3 mt-1">
                    <div className="w-6 h-6 rounded-full ring-1 ring-border shadow-sm" style={{ backgroundColor: preset.primary }} />
                    <div className="w-6 h-6 rounded-full ring-1 ring-border shadow-sm" style={{ backgroundColor: preset.secondary }} />
                    <div className="w-6 h-6 rounded-full ring-1 ring-border shadow-sm" style={{ backgroundColor: preset.accent }} />
                  </div>
                  <p className="text-sm font-medium">{preset.name}</p>
                </button>
              ))}
            </div>

            {/* Custom Color Inputs */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {['Primary', 'Secondary', 'Accent'].map((label, i) => {
                const key = i === 0 ? 'primaryColor' : i === 1 ? 'secondaryColor' : 'accentColor'
                const val = visuals[key as keyof WizardVisuals] as string
                return (
                  <div key={label} className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full border shadow-sm shrink-0" style={{ backgroundColor: val }} />
                      <Input
                        value={val}
                        onChange={(e) => onUpdate({ [key]: e.target.value })}
                        className="h-8 text-xs font-mono px-2"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Logo Upload - Simplified */}
        <div className="space-y-4 pt-4 border-t">
          <Label className="text-base font-medium">Logo <span className="text-muted-foreground font-normal text-sm ml-2">(Optional)</span></Label>
          <div className="border-2 border-dashed border-muted rounded-xl p-8 transition-colors hover:border-primary/50 cursor-pointer flex flex-col items-center justify-center text-center">
            <div className="h-10 w-10 bg-muted rounded-full flex items-center justify-center mb-3">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Click to upload your logo</p>
            <p className="text-xs text-muted-foreground mt-1">SVG, PNG, JPG or GIF (max. 5MB)</p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function OptionCard({
  icon,
  title,
  description,
  selected,
  onClick,
  variants
}: {
  icon?: string,
  title: string,
  description: string,
  selected: boolean,
  onClick: () => void,
  variants?: any
}) {
  return (
    <motion.button
      variants={variants}
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-start text-left p-5 h-full rounded-xl border-2 transition-all duration-200 outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
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
    </motion.button>
  )
}
