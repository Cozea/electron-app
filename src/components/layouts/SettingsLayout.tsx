import type { ReactNode } from 'react'
import { TitleBar } from '../TitleBar'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { cn } from '@/lib/utils'
import {
  X,
  Settings,
  Users,
  Key,
  CreditCard,
  Bell,
  Shield,
  Puzzle,
} from 'lucide-react'

export interface SettingsSection {
  id: string
  title: string
  icon: React.ElementType
}

interface SettingsLayoutProps {
  // Scope
  scope: 'org' | 'project'
  onScopeChange?: (scope: 'org' | 'project') => void

  // Sections
  sections: SettingsSection[]
  activeSection: string
  onSectionChange?: (section: string) => void

  // Content
  children: ReactNode
  title: string
  description?: string

  // Actions
  onClose?: () => void
  onSave?: () => void
  hasChanges?: boolean
  isSaving?: boolean
}

const defaultOrgSections: SettingsSection[] = [
  { id: 'general', title: 'General', icon: Settings },
  { id: 'members', title: 'Members', icon: Users },
  { id: 'security', title: 'Security', icon: Shield },
  { id: 'billing', title: 'Billing', icon: CreditCard },
  { id: 'notifications', title: 'Notifications', icon: Bell },
]

const defaultProjectSections: SettingsSection[] = [
  { id: 'general', title: 'General', icon: Settings },
  { id: 'environment', title: 'Environment', icon: Key },
  { id: 'integrations', title: 'Integrations', icon: Puzzle },
  { id: 'notifications', title: 'Notifications', icon: Bell },
]

export function SettingsLayout({
  scope,
  onScopeChange,
  sections,
  activeSection,
  onSectionChange,
  children,
  title,
  description,
  onClose,
  onSave,
  hasChanges = false,
  isSaving = false,
}: SettingsLayoutProps) {
  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      {/* Title Bar */}
      <TitleBar />

      {/* Header */}
      <header className="mt-10 h-14 border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-4 pl-14">
          <h1 className="font-semibold">Settings</h1>
          <Tabs value={scope} onValueChange={(v) => onScopeChange?.(v as 'org' | 'project')}>
            <TabsList className="h-8">
              <TabsTrigger value="org" className="text-xs">
                Organization
              </TabsTrigger>
              <TabsTrigger value="project" className="text-xs">
                Project
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border flex flex-col">
          <ScrollArea className="flex-1">
            <nav className="p-2 space-y-1">
              {sections.map((section) => (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start gap-2',
                    activeSection === section.id && 'bg-accent'
                  )}
                  size="sm"
                  onClick={() => onSectionChange?.(section.id)}
                >
                  <section.icon className="h-4 w-4" />
                  {section.title}
                </Button>
              ))}
            </nav>
          </ScrollArea>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content Header */}
          <div className="px-8 py-6 border-b border-border">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description && (
              <p className="text-muted-foreground mt-1">{description}</p>
            )}
          </div>

          {/* Content Body */}
          <ScrollArea className="flex-1">
            <div className="p-8 max-w-2xl">
              {children}
            </div>
          </ScrollArea>

          {/* Footer with Save */}
          {hasChanges && (
            <footer className="px-8 py-4 border-t border-border flex items-center justify-end gap-3 bg-muted/50">
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Discard
              </Button>
              <Button onClick={onSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </footer>
          )}
        </div>
      </div>
    </div>
  )
}

// Export default sections for convenience
export { defaultOrgSections, defaultProjectSections }
