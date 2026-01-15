import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { Progress } from '../components/ui/progress'
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Layout,
  Palette,
  Users,
  FileCode,
  Rocket,
  Check,
} from 'lucide-react'

const steps = [
  { id: 'intent', title: 'Intent', icon: Sparkles },
  { id: 'template', title: 'Template', icon: Layout },
  { id: 'stack', title: 'Stack', icon: FileCode },
  { id: 'visuals', title: 'Visuals', icon: Palette },
  { id: 'team', title: 'Team', icon: Users },
  { id: 'review', title: 'Review', icon: Rocket },
]

const templates = [
  { id: 'blank', name: 'Blank Project', description: 'Start from scratch' },
  { id: 'saas', name: 'SaaS Starter', description: 'Auth, billing, dashboard' },
  { id: 'ecommerce', name: 'E-commerce', description: 'Products, cart, checkout' },
  { id: 'blog', name: 'Blog Platform', description: 'Posts, comments, CMS' },
  { id: 'dashboard', name: 'Admin Dashboard', description: 'Analytics, tables, charts' },
  { id: 'landing', name: 'Landing Page', description: 'Marketing site with CTA' },
]

const frameworks = [
  { id: 'nextjs', name: 'Next.js', category: 'Framework' },
  { id: 'react', name: 'React', category: 'Framework' },
  { id: 'vue', name: 'Vue.js', category: 'Framework' },
]

const uiLibraries = [
  { id: 'tailwind', name: 'Tailwind CSS', category: 'Styling' },
  { id: 'shadcn', name: 'shadcn/ui', category: 'Components' },
  { id: 'chakra', name: 'Chakra UI', category: 'Components' },
]

const databases = [
  { id: 'postgres', name: 'PostgreSQL', category: 'Database' },
  { id: 'mongodb', name: 'MongoDB', category: 'Database' },
  { id: 'convex', name: 'Convex', category: 'Database' },
]

export function NewProject() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [projectData, setProjectData] = useState({
    name: '',
    description: '',
    audience: '',
    template: '',
    framework: 'nextjs',
    ui: 'tailwind',
    database: 'convex',
    primaryColor: '#6366f1',
    fontStyle: 'modern',
  })

  const progress = ((currentStep + 1) / steps.length) * 100

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    } else {
      navigate('/projects')
    }
  }

  const renderStepContent = () => {
    switch (steps[currentStep].id) {
      case 'intent':
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                placeholder="My Awesome Project"
                value={projectData.name}
                onChange={(e) => setProjectData({ ...projectData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">What are you building?</Label>
              <textarea
                id="description"
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Describe your project in a few sentences. What problem does it solve? What features should it have?"
                value={projectData.description}
                onChange={(e) => setProjectData({ ...projectData, description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audience">Who is it for?</Label>
              <Input
                id="audience"
                placeholder="e.g., Small business owners, developers, students..."
                value={projectData.audience}
                onChange={(e) => setProjectData({ ...projectData, audience: e.target.value })}
              />
            </div>
          </div>
        )

      case 'template':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {templates.map((template) => (
              <Card
                key={template.id}
                className={`cursor-pointer transition-colors ${
                  projectData.template === template.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-accent/50'
                }`}
                onClick={() => setProjectData({ ...projectData, template: template.id })}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    {template.name}
                    {projectData.template === template.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs">{template.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        )

      case 'stack':
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label>Framework</Label>
              <div className="flex gap-2">
                {frameworks.map((fw) => (
                  <Badge
                    key={fw.id}
                    variant={projectData.framework === fw.id ? 'default' : 'outline'}
                    className="cursor-pointer px-4 py-2"
                    onClick={() => setProjectData({ ...projectData, framework: fw.id })}
                  >
                    {fw.name}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label>UI Library</Label>
              <div className="flex gap-2">
                {uiLibraries.map((ui) => (
                  <Badge
                    key={ui.id}
                    variant={projectData.ui === ui.id ? 'default' : 'outline'}
                    className="cursor-pointer px-4 py-2"
                    onClick={() => setProjectData({ ...projectData, ui: ui.id })}
                  >
                    {ui.name}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label>Database</Label>
              <div className="flex gap-2">
                {databases.map((db) => (
                  <Badge
                    key={db.id}
                    variant={projectData.database === db.id ? 'default' : 'outline'}
                    className="cursor-pointer px-4 py-2"
                    onClick={() => setProjectData({ ...projectData, database: db.id })}
                  >
                    {db.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )

      case 'visuals':
        return (
          <div className="space-y-6">
            <div className="space-y-3">
              <Label>Primary Color</Label>
              <div className="flex gap-3">
                {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map((color) => (
                  <button
                    key={color}
                    className={`w-10 h-10 rounded-full transition-transform ${
                      projectData.primaryColor === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setProjectData({ ...projectData, primaryColor: color })}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <Label>Font Style</Label>
              <div className="flex gap-2">
                {[
                  { id: 'modern', name: 'Modern', sample: 'Inter' },
                  { id: 'classic', name: 'Classic', sample: 'Georgia' },
                  { id: 'mono', name: 'Monospace', sample: 'JetBrains Mono' },
                ].map((font) => (
                  <Card
                    key={font.id}
                    className={`cursor-pointer flex-1 ${
                      projectData.fontStyle === font.id ? 'border-primary' : ''
                    }`}
                    onClick={() => setProjectData({ ...projectData, fontStyle: font.id })}
                  >
                    <CardContent className="p-4 text-center">
                      <p className="font-medium">{font.name}</p>
                      <p className="text-xs text-muted-foreground">{font.sample}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        )

      case 'team':
        return (
          <div className="space-y-6">
            <p className="text-muted-foreground">
              Invite team members to collaborate on this project. You can skip this step and add members later.
            </p>
            <div className="space-y-2">
              <Label htmlFor="invite">Invite by email</Label>
              <div className="flex gap-2">
                <Input id="invite" placeholder="colleague@example.com" className="flex-1" />
                <Button variant="outline">Add</Button>
              </div>
            </div>
            <div className="border rounded-lg p-4 text-center text-muted-foreground">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No team members added yet</p>
            </div>
          </div>
        )

      case 'review':
        return (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{projectData.name || 'Untitled Project'}</CardTitle>
                <CardDescription>{projectData.description || 'No description'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-24">Template:</span>
                  <Badge variant="secondary">
                    {templates.find((t) => t.id === projectData.template)?.name || 'Blank'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-24">Stack:</span>
                  <div className="flex gap-1">
                    <Badge variant="secondary">
                      {frameworks.find((f) => f.id === projectData.framework)?.name}
                    </Badge>
                    <Badge variant="secondary">
                      {uiLibraries.find((u) => u.id === projectData.ui)?.name}
                    </Badge>
                    <Badge variant="secondary">
                      {databases.find((d) => d.id === projectData.database)?.name}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground w-24">Theme:</span>
                  <div
                    className="w-6 h-6 rounded-full"
                    style={{ backgroundColor: projectData.primaryColor }}
                  />
                </div>
              </CardContent>
            </Card>
            <Button className="w-full gap-2" size="lg">
              <Rocket className="h-4 w-4" />
              Create Project
            </Button>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: 'New Project' },
      ]}
    >
      <div className="max-w-3xl mx-auto">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-semibold">New Project</h1>
            <span className="text-sm text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Indicators */}
        <div className="flex items-center justify-between mb-8">
          {steps.map((step, index) => {
            const Icon = step.icon
            const isActive = index === currentStep
            const isCompleted = index < currentStep
            return (
              <div
                key={step.id}
                className={`flex flex-col items-center gap-1 ${
                  isActive
                    ? 'text-foreground'
                    : isCompleted
                    ? 'text-primary'
                    : 'text-muted-foreground'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                      ? 'bg-primary/10'
                      : 'bg-muted'
                  }`}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <span className="text-xs font-medium">{step.title}</span>
              </div>
            )
          })}
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep].title}</CardTitle>
            <CardDescription>
              {currentStep === 0 && 'Tell us about your project'}
              {currentStep === 1 && 'Choose a starting template'}
              {currentStep === 2 && 'Select your tech stack'}
              {currentStep === 3 && 'Customize the look and feel'}
              {currentStep === 4 && 'Add team members'}
              {currentStep === 5 && 'Review and create your project'}
            </CardDescription>
          </CardHeader>
          <CardContent>{renderStepContent()}</CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <Button variant="outline" onClick={handleBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </Button>
          {currentStep < steps.length - 1 && (
            <Button onClick={handleNext} className="gap-2">
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
