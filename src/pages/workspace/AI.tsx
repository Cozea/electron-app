import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Badge } from '../../components/ui/badge'
import { Progress } from '../../components/ui/progress'
import { Switch } from '../../components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Key,
  Eye,
  EyeOff,
  Check,
  X,
  AlertCircle,
  Sparkles,
  MessageSquare,
  Code,
  Rocket,
} from 'lucide-react'

const providers = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4, GPT-3.5 Turbo',
    connected: true,
    key: 'sk-...abc123',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5, Claude 3',
    connected: true,
    key: 'sk-ant-...xyz789',
  },
  {
    id: 'google',
    name: 'Google AI',
    description: 'Gemini Pro, Gemini Ultra',
    connected: false,
    key: '',
  },
]

const models = {
  chat: ['claude-3-5-sonnet', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  code: ['claude-3-5-sonnet', 'gpt-4-turbo', 'codellama'],
  builder: ['claude-3-5-sonnet', 'gpt-4-turbo'],
}

export function AI() {
  const { user, logout } = useAuth()
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [budgetLimit, setBudgetLimit] = useState('100')

  const usage = {
    current: 67.50,
    limit: 100,
    tokens: 1_250_000,
    breakdown: [
      { model: 'claude-3-5-sonnet', amount: 42.30, percentage: 63 },
      { model: 'gpt-4-turbo', amount: 18.20, percentage: 27 },
      { model: 'gpt-3.5-turbo', amount: 7.00, percentage: 10 },
    ],
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'AI' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">AI Configuration</h1>
        <p className="text-muted-foreground">
          Manage AI providers, models, and usage
        </p>
      </div>

      <div className="space-y-6">
        {/* API Keys */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
            <CardDescription>
              Connect your AI provider accounts. Keys are encrypted at rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{provider.name}</h4>
                      {provider.connected ? (
                        <Badge variant="secondary" className="gap-1">
                          <Check className="h-3 w-3" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <X className="h-3 w-3" />
                          Not connected
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{provider.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {provider.connected && (
                    <div className="flex items-center gap-2 mr-4">
                      <Input
                        type={showKeys[provider.id] ? 'text' : 'password'}
                        value={provider.key}
                        readOnly
                        className="w-36 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setShowKeys({ ...showKeys, [provider.id]: !showKeys[provider.id] })
                        }
                      >
                        {showKeys[provider.id] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  )}
                  <Button variant={provider.connected ? 'outline' : 'default'}>
                    {provider.connected ? 'Update' : 'Connect'}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Default Models */}
        <Card>
          <CardHeader>
            <CardTitle>Default Models</CardTitle>
            <CardDescription>
              Choose which models to use for different tasks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <Label>Chat Conversations</Label>
                </div>
                <Select defaultValue="claude-3-5-sonnet">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.chat.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <Label>Code Generation</Label>
                </div>
                <Select defaultValue="claude-3-5-sonnet">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.code.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-muted-foreground" />
                  <Label>Project Builder</Label>
                </div>
                <Select defaultValue="claude-3-5-sonnet">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {models.builder.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Usage & Budget */}
        <Card>
          <CardHeader>
            <CardTitle>Usage & Budget</CardTitle>
            <CardDescription>
              Monitor your AI spending and set limits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Current Month Spending</span>
                  <span className="text-2xl font-bold">${usage.current.toFixed(2)}</span>
                </div>
                <Progress value={(usage.current / usage.limit) * 100} />
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{Math.round((usage.current / usage.limit) * 100)}% of ${usage.limit} limit</span>
                  <span>{usage.tokens.toLocaleString()} tokens used</span>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="budget">Monthly Budget Limit</Label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">$</span>
                      <Input
                        id="budget"
                        type="number"
                        value={budgetLimit}
                        onChange={(e) => setBudgetLimit(e.target.value)}
                        className="w-24"
                      />
                    </div>
                  </div>
                  <Button>Update</Button>
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Spending by Model</h4>
              {usage.breakdown.map((item) => (
                <div key={item.model} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{item.model}</span>
                    <span>${item.amount.toFixed(2)}</span>
                  </div>
                  <Progress value={item.percentage} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Budget Alerts</CardTitle>
            <CardDescription>
              Get notified when approaching your budget limit
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alert at 50%</p>
                  <p className="text-sm text-muted-foreground">
                    Notify when spending reaches $50
                  </p>
                </div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Alert at 80%</p>
                  <p className="text-sm text-muted-foreground">
                    Notify when spending reaches $80
                  </p>
                </div>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="font-medium">Alert at 100%</p>
                  <p className="text-sm text-muted-foreground">
                    Notify when budget limit is reached
                  </p>
                </div>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
