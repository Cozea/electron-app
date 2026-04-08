import { Check } from 'lucide-react'

import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { useTheme } from '../../contexts/ThemeContext'
import type { Theme } from '@/lib/theme'
import { cn } from '../../lib/utils'

interface AppearanceProps {
  surface?: 'page' | 'drawer'
  route?: string
}

// Theme preview colors (matching index.css)
const themes: { value: Theme; label: string; colors: { bg: string; card: string; primary: string; muted: string } }[] = [
  {
    value: 'light',
    label: 'Light',
    colors: { bg: '#ffffff', card: '#ffffff', primary: '#1a1a2e', muted: '#f5f5f5' },
  },
  {
    value: 'dark',
    label: 'Dark',
    colors: { bg: '#1a1a1a', card: '#262626', primary: '#e5e5e5', muted: '#404040' },
  },
  {
    value: 'navy',
    label: 'Navy',
    colors: { bg: '#0f1729', card: '#141d30', primary: '#5a9cf5', muted: '#1e2a42' },
  },
  {
    value: 'wine',
    label: 'Wine',
    colors: { bg: '#2a1520', card: '#321a24', primary: '#d64074', muted: '#3d2430' },
  },
  {
    value: 'clay',
    label: 'Clay',
    colors: { bg: '#1c1814', card: '#252019', primary: '#c4956a', muted: '#2e2822' },
  },
  {
    value: 'forest',
    label: 'Forest',
    colors: { bg: '#142118', card: '#1a2b20', primary: '#3d7a57', muted: '#243d2d' },
  },
  {
    value: 'system',
    label: 'System',
    colors: {
      bg: 'linear-gradient(135deg, #ffffff 50%, #1a1a1a 50%)',
      card: '',
      primary: '',
      muted: '',
    },
  },
]

export function Appearance({ surface = 'page', route: _route }: AppearanceProps) {
  const { theme, setTheme } = useTheme()

  const content = (
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-4xl space-y-8 px-6 py-6'
          : 'max-w-3xl space-y-8 px-6 pt-6'
      }
    >
      <div>
        <h3 className="text-base font-medium mb-1">Theme</h3>
        <p className="text-sm text-muted-foreground mb-4">Choose your preferred color scheme</p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {themes.map((t) => {
            const isSelected = theme === t.value
            const isSystem = t.value === 'system'

            return (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={cn(
                  'relative flex flex-col rounded-lg overflow-hidden transition-all',
                  'hover:ring-2 hover:ring-ring/50',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected && 'ring-2 ring-primary'
                )}
              >
                <div className="aspect-[4/3] p-2" style={{ background: t.colors.bg }}>
                  {isSystem ? (
                    <div className="h-full flex">
                      <div className="w-1/2 p-1.5 flex flex-col gap-1">
                        <div className="h-1.5 w-6 rounded-sm bg-[#1a1a2e]" />
                        <div className="flex-1 rounded bg-[#f5f5f5] p-1">
                          <div className="h-1 w-full rounded-sm bg-[#e5e5e5] mb-1" />
                          <div className="h-1 w-3/4 rounded-sm bg-[#e5e5e5]" />
                        </div>
                        <div className="h-2 w-8 rounded-sm bg-[#1a1a2e]" />
                      </div>
                      <div className="w-1/2 p-1.5 flex flex-col gap-1 bg-[#1a1a1a]">
                        <div className="h-1.5 w-6 rounded-sm bg-[#e5e5e5]" />
                        <div className="flex-1 rounded bg-[#262626] p-1">
                          <div className="h-1 w-full rounded-sm bg-[#404040] mb-1" />
                          <div className="h-1 w-3/4 rounded-sm bg-[#404040]" />
                        </div>
                        <div className="h-2 w-8 rounded-sm bg-[#e5e5e5]" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col gap-1">
                      <div className="h-1.5 w-8 rounded-sm" style={{ backgroundColor: t.colors.primary }} />
                      <div className="flex-1 rounded p-1.5" style={{ backgroundColor: t.colors.card }}>
                        <div className="h-1 w-full rounded-sm mb-1" style={{ backgroundColor: t.colors.muted }} />
                        <div className="h-1 w-3/4 rounded-sm mb-1" style={{ backgroundColor: t.colors.muted }} />
                        <div className="h-1 w-1/2 rounded-sm" style={{ backgroundColor: t.colors.muted }} />
                      </div>
                      <div className="h-2.5 w-10 rounded-sm" style={{ backgroundColor: t.colors.primary }} />
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    'py-2 px-3 text-xs font-medium text-center',
                    isSelected ? 'bg-accent text-accent-foreground' : 'bg-muted/50 text-muted-foreground'
                  )}
                >
                  {t.label}
                </div>
                {isSelected && (
                  <div className="absolute top-1.5 right-1.5 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </div>
                )}
              </button>
            )
          })}
          <button
            disabled
            className="relative flex flex-col rounded-lg overflow-hidden transition-all opacity-50 cursor-not-allowed"
          >
            <div className="aspect-[4/3] p-2" style={{ background: '#71717a' }}>
              <div className="h-full flex flex-col gap-1">
                <div className="h-1.5 w-8 rounded-sm bg-white/60" />
                <div className="flex-1 rounded p-1.5 bg-white/10">
                  <div className="h-1 w-full rounded-sm bg-white/20 mb-1" />
                  <div className="h-1 w-3/4 rounded-sm bg-white/20 mb-1" />
                  <div className="h-1 w-1/2 rounded-sm bg-white/20" />
                </div>
                <div className="h-2.5 w-10 rounded-sm bg-white/60" />
              </div>
            </div>
            <div className="py-2 px-3 text-xs font-medium text-center bg-muted/50 text-muted-foreground">
              Custom
            </div>
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium mb-1">Interface</h3>
        <p className="text-sm text-muted-foreground mb-4">Customize the user interface</p>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Compact Mode</Label>
              <p className="text-sm text-muted-foreground">Reduce spacing for more content</p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Sidebar Collapsed by Default</Label>
              <p className="text-sm text-muted-foreground">Start with the sidebar minimized</p>
            </div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Reduce Motion</Label>
              <p className="text-sm text-muted-foreground">Minimize animations for accessibility</p>
            </div>
            <Switch />
          </div>
        </div>
      </div>
    </div>
  )

  if (surface === 'drawer') {
    return content
  }

  return content
}
