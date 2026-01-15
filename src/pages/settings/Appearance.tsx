import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { Sun, Moon, Monitor, Check } from 'lucide-react'

const themes = [
  { id: 'light', name: 'Light', icon: Sun, preview: 'bg-white border' },
  { id: 'dark', name: 'Dark', icon: Moon, preview: 'bg-zinc-900 border-zinc-700' },
  { id: 'system', name: 'System', icon: Monitor, preview: 'bg-gradient-to-r from-white to-zinc-900' },
]

const accentColors = [
  { id: 'indigo', value: '#6366f1', name: 'Indigo' },
  { id: 'blue', value: '#3b82f6', name: 'Blue' },
  { id: 'green', value: '#10b981', name: 'Green' },
  { id: 'amber', value: '#f59e0b', name: 'Amber' },
  { id: 'red', value: '#ef4444', name: 'Red' },
  { id: 'purple', value: '#8b5cf6', name: 'Purple' },
  { id: 'pink', value: '#ec4899', name: 'Pink' },
  { id: 'cyan', value: '#06b6d4', name: 'Cyan' },
]

const fonts = [
  { id: 'inter', name: 'Inter', sample: 'The quick brown fox jumps over the lazy dog' },
  { id: 'jetbrains', name: 'JetBrains Mono', sample: 'const foo = "bar"' },
  { id: 'fira', name: 'Fira Code', sample: 'fn main() => {}' },
  { id: 'source', name: 'Source Code Pro', sample: 'function hello()' },
]

export function Appearance() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [accentColor, setAccentColor] = useState('indigo')
  const [editorFont, setEditorFont] = useState('jetbrains')
  const [fontSize, setFontSize] = useState('14')
  const [tabSize, setTabSize] = useState('2')

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Appearance' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Appearance</h1>
        <p className="text-muted-foreground">
          Customize the look and feel of your workspace
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Theme */}
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>
              Choose your preferred color scheme
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {themes.map((t) => {
                const Icon = t.icon
                const isSelected = theme === t.id
                return (
                  <button
                    key={t.id}
                    className={`relative p-4 rounded-lg border-2 transition-colors ${
                      isSelected ? 'border-primary' : 'border-transparent hover:border-muted'
                    }`}
                    onClick={() => setTheme(t.id as 'light' | 'dark' | 'system')}
                  >
                    <div className={`w-full h-24 rounded-md mb-3 ${t.preview}`} />
                    <div className="flex items-center justify-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{t.name}</span>
                    </div>
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Accent Color */}
        <Card>
          <CardHeader>
            <CardTitle>Accent Color</CardTitle>
            <CardDescription>
              Choose the primary color used throughout the app
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {accentColors.map((color) => (
                <button
                  key={color.id}
                  className={`relative w-10 h-10 rounded-full transition-transform ${
                    accentColor === color.id ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                  }`}
                  style={{ backgroundColor: color.value }}
                  onClick={() => setAccentColor(color.id)}
                  title={color.name}
                >
                  {accentColor === color.id && (
                    <Check className="absolute inset-0 m-auto h-5 w-5 text-white" />
                  )}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Editor Font */}
        <Card>
          <CardHeader>
            <CardTitle>Editor Font</CardTitle>
            <CardDescription>
              Choose the font for code editing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <RadioGroup value={editorFont} onValueChange={setEditorFont}>
              {fonts.map((font) => (
                <div
                  key={font.id}
                  className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer ${
                    editorFont === font.id ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => setEditorFont(font.id)}
                >
                  <RadioGroupItem value={font.id} id={font.id} />
                  <div className="flex-1">
                    <Label htmlFor={font.id} className="cursor-pointer">
                      {font.name}
                    </Label>
                    <p
                      className="text-sm text-muted-foreground mt-1"
                      style={{ fontFamily: font.name }}
                    >
                      {font.sample}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Editor Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Editor Settings</CardTitle>
            <CardDescription>
              Fine-tune your code editor preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Font Size</Label>
                <Select value={fontSize} onValueChange={setFontSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12px</SelectItem>
                    <SelectItem value="13">13px</SelectItem>
                    <SelectItem value="14">14px</SelectItem>
                    <SelectItem value="15">15px</SelectItem>
                    <SelectItem value="16">16px</SelectItem>
                    <SelectItem value="18">18px</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tab Size</Label>
                <Select value={tabSize} onValueChange={setTabSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 spaces</SelectItem>
                    <SelectItem value="4">4 spaces</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Word Wrap</Label>
                  <p className="text-sm text-muted-foreground">
                    Wrap long lines of code
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Minimap</Label>
                  <p className="text-sm text-muted-foreground">
                    Show code overview on the side
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Bracket Colorization</Label>
                  <p className="text-sm text-muted-foreground">
                    Color matching brackets
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Line Numbers</Label>
                  <p className="text-sm text-muted-foreground">
                    Show line numbers in the editor
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Interface */}
        <Card>
          <CardHeader>
            <CardTitle>Interface</CardTitle>
            <CardDescription>
              Customize the user interface
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Compact Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Reduce spacing for more content
                </p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Sidebar Collapsed by Default</Label>
                <p className="text-sm text-muted-foreground">
                  Start with the sidebar minimized
                </p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Reduce Motion</Label>
                <p className="text-sm text-muted-foreground">
                  Minimize animations for accessibility
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Button>Save Preferences</Button>
      </div>
    </DashboardLayout>
  )
}
