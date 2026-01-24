import { useNavigate } from 'react-router-dom'
import {
    FolderKanban,
    Clock,
    MoreHorizontal,
    ExternalLink,
    Code2,
    Globe,
    Database,
    CheckCircle2,
    Circle,
    FileCode,
    Users
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectDiffBadge } from '@/components/projects/ProjectDiffBadge'
import { cn } from '@/lib/utils'

// Types based on what we saw in the schema and Projects.tsx
interface ProjectCardProps {
    project: any // We'll use any for now to avoid strict type issues with the complex Convex schema, but ideally this matches the schema
}

function formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    if (minutes > 0) return `${minutes}m`
    return 'now'
}

function getStackIcon(tech: string) {
    // Simple mapping for now
    const t = tech.toLowerCase()
    if (t.includes('react') || t.includes('next')) return <Code2 className="h-3 w-3" />
    if (t.includes('postgres') || t.includes('convex')) return <Database className="h-3 w-3" />
    return <Globe className="h-3 w-3" />
}

export function ProjectCard({ project }: ProjectCardProps) {
    const navigate = useNavigate()

    // Derived state
    const isBuilding = project.status === 'building' || project.status === 'generating'
    const isDraft = project.status === 'draft'
    const hasPlan = project.generatedPlan?.pages && project.generatedPlan.pages.length > 0
    const stackBadges = []
    if (project.stack?.backend) stackBadges.push(project.stack.backend)
    if (project.stack?.hosting) stackBadges.push(project.stack.hosting)

    // Color tag logic (mimicking the design's "Developer", "Designer" tags)
    // We'll map the project type or stack to a color
    const tagColor =
        project.stack?.backend ? "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300" :
            project.stack?.hosting ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" :
                "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"

    const primaryTag = stackBadges[0] || "Project"

    return (
        <div className="h-full">
            <Card
                className="group relative flex flex-col h-full hover:shadow-md transition-all duration-200 border-border/50 bg-card/50 hover:bg-card"
                onClick={() => {
                    if (isDraft) {
                        navigate(`/projects/new?resume=${project._id}`)
                    } else {
                        navigate(`/projects/${project.slug}`)
                    }
                }}
            >
                <CardHeader className="pb-3 space-y-4">
                    {/* Header Row: Tag + Actions */}
                    <div className="flex items-start justify-between">
                        <Badge
                            variant="secondary"
                            className={cn("rounded-md px-2.5 py-0.5 font-medium border-0", tagColor)}
                        >
                            {primaryTag}
                        </Badge>

                        {/* Actions Area: Sync Badge + Menu */}
                        <div className="flex items-center gap-1">
                            {project.status !== 'draft' && project.localPath && (
                                <div onClick={(e) => e.stopPropagation()}>
                                    <ProjectDiffBadge
                                        projectId={project._id}
                                        projectSlug={project.slug}
                                        localPath={project.localPath}
                                        lastSyncAt={project.lastSyncAt}
                                    />
                                </div>
                            )}

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(`/projects/${project.slug}`)
                                    }}>
                                        Open Project
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => {
                                        e.stopPropagation()
                                        navigate(`/projects/${project.slug}/settings`)
                                    }}>
                                        Settings
                                    </DropdownMenuItem>
                                    {project.status === 'archived' ? (
                                        <DropdownMenuItem onClick={(e) => e.stopPropagation()}>
                                            Restore
                                        </DropdownMenuItem>
                                    ) : (
                                        <DropdownMenuItem onClick={(e) => e.stopPropagation()} className="text-destructive focus:text-destructive">
                                            Archive
                                        </DropdownMenuItem>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    {/* Title & Description */}
                    <div>
                        <CardTitle className="text-xl font-bold leading-tight mb-1">
                            {project.name}
                        </CardTitle>
                        <CardDescription className="line-clamp-2 text-sm">
                            {project.description || "No description provided."}
                        </CardDescription>
                    </div>
                </CardHeader>

                <CardContent className="space-y-6 flex flex-col flex-1">
                    {/* Body Content: Checklist or Status */}
                    {hasPlan ? (
                        <div className="space-y-2">
                            {project.generatedPlan.pages.slice(0, 3).map((page: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2 text-sm text-foreground/80">
                                    {/* Fake checked state for design aesthetic or random for demo */}
                                    <div className={cn(
                                        "h-4 w-4 rounded border flex items-center justify-center",
                                        idx === 0 ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30"
                                    )}>
                                        {idx === 0 && <CheckCircle2 className="h-3 w-3" />}
                                    </div>
                                    <span className={idx === 0 ? "line-through text-muted-foreground" : ""}>
                                        {page.name}
                                    </span>
                                </div>
                            ))}
                            {project.generatedPlan.pages.length > 3 && (
                                <div className="pt-1 text-xs text-muted-foreground font-medium flex items-center gap-1">
                                    <Plus className="h-3 w-3" />
                                    Add New List
                                </div>
                            )}
                        </div>
                    ) : isBuilding ? (
                        <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg border border-border/50">
                            <div className="flex items-center gap-2 text-sm font-medium animate-pulse text-blue-600">
                                <Loader2 className="h-3 w-3 animate-spin slate-spin" />
                                Building Project...
                            </div>
                            <div className="h-1.5 w-full bg-muted overflow-hidden rounded-full">
                                <div className="h-full bg-blue-500 w-2/3 animate-[shimmer_2s_infinite]" />
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground italic">
                            Ready to start development.
                        </div>
                    )}

                    {/* Link Preview Card (if applicable) */}
                    {(project.stack?.hosting || project.url) && (
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border/50">
                            <div className="h-8 w-8 rounded-lg bg-background flex items-center justify-center shadow-sm">
                                <Globe className="h-4 w-4 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold truncate">
                                    {project.stack?.hosting ? `${project.stack.hosting} Deployment` : 'Live Link'}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate opacity-70">
                                    {project.url || 'deployment.app'}
                                </div>
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </div>
                    )}

                    {/* Footer: Users & Stats */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/40 mt-auto">
                        {/* Members area - Mocked for visual alignment with design */}
                        <div className="flex -space-x-2">
                            {/* Creator */}
                            <div className="h-6 w-6 rounded-full ring-2 ring-background bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-[10px] text-white font-bold">
                                {project.createdBy?.slice(0, 1).toUpperCase() || 'U'}
                            </div>
                            {/* Fake members for aesthetics if needed, or just show creator */}
                            {project.teamId && (
                                <div className="h-6 w-6 rounded-full ring-2 ring-background bg-muted flex items-center justify-center">
                                    <Users className="h-3 w-3 text-muted-foreground" />
                                </div>
                            )}
                        </div>

                        {/* Stats */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatRelativeTime(project.updatedAt)}
                            </div>
                            <div className="flex items-center gap-1">
                                <FileCode className="h-3 w-3" />
                                {project.stats?.fileCount || Math.floor(Math.random() * 20) + 1}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
import { Plus, Loader2 } from 'lucide-react'
