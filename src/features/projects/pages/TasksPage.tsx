import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ListTodo,
  RefreshCw,
  Loader2,
  Plus,
  Search,
  Calendar,
  Tag,
  MoreHorizontal,
  Circle,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TaskStatus = 'todo' | 'in_progress' | 'done'
type TaskPriority = 'low' | 'medium' | 'high'

interface Task {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assignee?: { name: string; avatar: string }
  dueDate?: number
  labels: string[]
  createdAt: number
}

// Mock tasks data
const mockTasks: Task[] = [
  {
    id: '1',
    title: 'Implement user authentication flow',
    description: 'Add login, logout, and session management',
    status: 'in_progress',
    priority: 'high',
    assignee: { name: 'John Doe', avatar: '' },
    dueDate: Date.now() + 1000 * 60 * 60 * 24 * 2, // 2 days
    labels: ['feature', 'auth'],
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
  },
  {
    id: '2',
    title: 'Fix mobile responsive layout',
    description: 'Sidebar breaks on screens < 768px',
    status: 'todo',
    priority: 'medium',
    assignee: { name: 'Jane Smith', avatar: '' },
    labels: ['bug', 'ui'],
    createdAt: Date.now() - 1000 * 60 * 60 * 48,
  },
  {
    id: '3',
    title: 'Add unit tests for API routes',
    status: 'todo',
    priority: 'low',
    labels: ['testing'],
    createdAt: Date.now() - 1000 * 60 * 60 * 72,
  },
  {
    id: '4',
    title: 'Set up CI/CD pipeline',
    status: 'done',
    priority: 'high',
    assignee: { name: 'Bob Wilson', avatar: '' },
    labels: ['devops'],
    createdAt: Date.now() - 1000 * 60 * 60 * 96,
  },
  {
    id: '5',
    title: 'Database schema migration',
    description: 'Add new columns for user preferences',
    status: 'in_progress',
    priority: 'medium',
    assignee: { name: 'John Doe', avatar: '' },
    dueDate: Date.now() + 1000 * 60 * 60 * 24 * 5, // 5 days
    labels: ['database'],
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
  },
]

export function TasksPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  const formatDueDate = (timestamp: number) => {
    const diff = timestamp - Date.now()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    if (days < 0) return 'Overdue'
    if (days === 0) return 'Today'
    if (days === 1) return 'Tomorrow'
    return `${days} days`
  }

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'todo':
        return <Circle className="h-4 w-4 text-muted-foreground" />
      case 'in_progress':
        return <Clock className="h-4 w-4 text-blue-500" />
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
    }
  }

  const getPriorityBadge = (priority: TaskPriority) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive" className="text-xs">High</Badge>
      case 'medium':
        return <Badge variant="secondary" className="text-xs">Medium</Badge>
      case 'low':
        return <Badge variant="outline" className="text-xs">Low</Badge>
    }
  }

  const filteredTasks = mockTasks.filter(task => {
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         task.description?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesStatus && matchesSearch
  })

  const taskCounts = {
    all: mockTasks.length,
    todo: mockTasks.filter(t => t.status === 'todo').length,
    in_progress: mockTasks.filter(t => t.status === 'in_progress').length,
    done: mockTasks.filter(t => t.status === 'done').length,
  }

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <ListTodo className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Tasks</h1>
          <Badge variant="secondary" className="text-xs">
            {mockTasks.length} tasks
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Task
          </Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('all')}
          >
            All ({taskCounts.all})
          </Button>
          <Button
            variant={statusFilter === 'todo' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('todo')}
          >
            To Do ({taskCounts.todo})
          </Button>
          <Button
            variant={statusFilter === 'in_progress' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('in_progress')}
          >
            In Progress ({taskCounts.in_progress})
          </Button>
          <Button
            variant={statusFilter === 'done' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('done')}
          >
            Done ({taskCounts.done})
          </Button>
        </div>

        <div className="relative flex-1 max-w-xs ml-auto">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
      </div>

      {/* Task List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredTasks.length === 0 ? (
            <Card className="p-12 text-center">
              <ListTodo className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Tasks Found</h3>
              <p className="text-sm text-muted-foreground">
                {statusFilter === 'all'
                  ? 'Create your first task to get started.'
                  : 'No tasks match your filters.'}
              </p>
            </Card>
          ) : (
            filteredTasks.map((task) => (
              <Card key={task.id} className="p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    {getStatusIcon(task.status)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "font-medium",
                        task.status === 'done' && "line-through text-muted-foreground"
                      )}>
                        {task.title}
                      </span>
                      {getPriorityBadge(task.priority)}
                    </div>

                    {task.description && (
                      <p className="text-sm text-muted-foreground mb-2 line-clamp-1">
                        {task.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      {task.labels.map((label) => (
                        <Badge key={label} variant="outline" className="text-xs">
                          <Tag className="h-3 w-3 mr-1" />
                          {label}
                        </Badge>
                      ))}

                      {task.dueDate && (
                        <div className={cn(
                          "flex items-center gap-1 text-xs",
                          task.dueDate < Date.now() ? "text-red-500" : "text-muted-foreground"
                        )}>
                          <Calendar className="h-3 w-3" />
                          {formatDueDate(task.dueDate)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {task.assignee && (
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={task.assignee.avatar} />
                        <AvatarFallback className="text-xs">
                          {task.assignee.name.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
