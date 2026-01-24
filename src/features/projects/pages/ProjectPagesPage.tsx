import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectPagesStore } from '@/stores/useProjectPagesStore'
import { useTerminalStore, useTerminalActions } from '@/stores/useTerminalStore'
import { scanForRoutes } from '@/utils/routeScanner'
import { ServerControl } from '../components/ServerControl'
import { TerminalPanel } from '../components/TerminalPanel'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
    FileText,
    Monitor,
    Tablet,
    Smartphone,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    AppWindow,
    Loader2,
    LayoutGrid,
    ExternalLink,
    Sparkles,
    Terminal,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function ProjectPagesPage() {
    const { slug } = useParams<{ slug: string }>()
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const { currentOrganization } = useAuth()

    // Store state
    const { routes, serverStatus, serverPort, actions } = useProjectPagesStore()
    const isPanelOpen = useTerminalStore((s) => s.isPanelOpen)
    const { togglePanel } = useTerminalActions()

    // Local state
    const [isScanningAI, setIsScanningAI] = useState(false)
    const [focusedPageIndex, setFocusedPageIndex] = useState<number | null>(() => {
        // Initialize from URL param if present
        const focus = searchParams.get('focus')
        return focus !== null ? parseInt(focus, 10) : null
    })
    const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [zoom, setZoom] = useState(100)
    const thumbnailStripRef = useRef<HTMLDivElement>(null)
    const iframeRef = useRef<HTMLIFrameElement>(null)

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

    // Extract stored framework info from project
    const storedFrameworkInfo = project?.frameworkInfo ? {
        framework: project.frameworkInfo.framework,
        devCommand: project.frameworkInfo.devCommand,
        devPort: project.frameworkInfo.devPort,
    } : null

    // Scan for routes when project loads
    useEffect(() => {
        if (project?.localPath) {
            refreshRoutes()
        }
    }, [project?.localPath])

    // Handle focus query param from PagesList clicks
    useEffect(() => {
        const focus = searchParams.get('focus')
        if (focus !== null && routes.length > 0) {
            const index = parseInt(focus, 10)
            if (index >= 0 && index < routes.length) {
                setFocusedPageIndex(index)
            }
            // Clear the param after setting focus
            searchParams.delete('focus')
            setSearchParams(searchParams, { replace: true })
        }
    }, [searchParams, routes.length, setSearchParams])

    // Handle escape key to exit focused view
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && focusedPageIndex !== null) {
                setFocusedPageIndex(null)
            }
            // Arrow keys for navigation in focused view
            if (focusedPageIndex !== null) {
                if (e.key === 'ArrowLeft') {
                    setFocusedPageIndex(prev => prev !== null && prev > 0 ? prev - 1 : routes.length - 1)
                } else if (e.key === 'ArrowRight') {
                    setFocusedPageIndex(prev => prev !== null && prev < routes.length - 1 ? prev + 1 : 0)
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [focusedPageIndex, routes.length])

    // Scroll thumbnail into view when focused page changes
    useEffect(() => {
        if (focusedPageIndex !== null && thumbnailStripRef.current) {
            const thumbnail = thumbnailStripRef.current.children[focusedPageIndex] as HTMLElement
            if (thumbnail) {
                thumbnail.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
            }
        }
    }, [focusedPageIndex])

    const refreshRoutes = async () => {
        if (!project?.localPath) return
        const result = await scanForRoutes(project.localPath, storedFrameworkInfo)
        actions.setRoutes(result.routes.map(r => ({ ...r, status: 'active' as const })))
    }

    const handleOpenCode = (file: string) => {
        // Navigate to editor with file path
        navigate(`/projects/${slug}?path=${encodeURIComponent(file)}`)
    }

    const focusedRoute = focusedPageIndex !== null ? routes[focusedPageIndex] : null

    if (project === undefined) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-background relative">
            {/* Header */}
            <TooltipProvider delayDuration={300}>
                <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-9 bg-transparent backdrop-blur-md transition-all">
                    <div className="flex items-center gap-3">
                        {focusedPageIndex !== null && (
                            <>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setFocusedPageIndex(null)}
                                            className="gap-2 h-8 px-2"
                                        >
                                            <LayoutGrid className="h-3.5 w-3.5" />
                                            <span className="text-xs">Grid</span>
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">
                                        <p>Back to grid view</p>
                                    </TooltipContent>
                                </Tooltip>
                                <div className="h-4 w-[1px] bg-sidebar-border" />
                            </>
                        )}
                        <div>
                            <h1 className="text-sm font-semibold text-foreground">
                                {focusedRoute ? focusedRoute.name : 'Pages'}
                            </h1>
                        </div>
                    </div>

                    {/* Device and Zoom Controls - only in focused view */}
                    {focusedPageIndex !== null && (
                        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
                            {/* Device toggle */}
                            <div className="flex items-center gap-1">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={device === 'desktop' ? 'secondary' : 'ghost'}
                                            size="icon"
                                            onClick={() => setDevice('desktop')}
                                            className={cn("h-7 w-7 rounded-md", device === 'desktop' && "bg-sidebar-accent shadow-none")}
                                        >
                                            <Monitor className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Desktop</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={device === 'tablet' ? 'secondary' : 'ghost'}
                                            size="icon"
                                            onClick={() => setDevice('tablet')}
                                            className={cn("h-7 w-7 rounded-md", device === 'tablet' && "bg-sidebar-accent shadow-none")}
                                        >
                                            <Tablet className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Tablet (768px)</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant={device === 'mobile' ? 'secondary' : 'ghost'}
                                            size="icon"
                                            onClick={() => setDevice('mobile')}
                                            className={cn("h-7 w-7 rounded-md", device === 'mobile' && "bg-sidebar-accent shadow-none")}
                                        >
                                            <Smartphone className="h-4 w-4" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Mobile (375px)</TooltipContent>
                                </Tooltip>
                            </div>

                            <div className="h-4 w-[1px] bg-sidebar-border mx-2" />

                            {/* Zoom controls */}
                            <div className="flex items-center gap-0.5">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setZoom(prev => Math.max(25, prev - 25))}
                                            className="h-7 w-7 rounded-md"
                                            disabled={zoom <= 25}
                                        >
                                            <ZoomOut className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Zoom out</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setZoom(100)}
                                            className="h-7 px-2 text-xs font-mono min-w-[3rem]"
                                        >
                                            {zoom}%
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Reset to 100%</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setZoom(prev => Math.min(200, prev + 25))}
                                            className="h-7 w-7 rounded-md"
                                            disabled={zoom >= 200}
                                        >
                                            <ZoomIn className="h-3.5 w-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Zoom in</TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refreshRoutes}>
                                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Refresh routes</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant={isPanelOpen ? "secondary" : "ghost"}
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={togglePanel}
                                >
                                    <Terminal className={cn("h-3.5 w-3.5", isPanelOpen ? "text-foreground" : "text-muted-foreground")} />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Toggle Terminal</TooltipContent>
                        </Tooltip>
                        <div className="h-4 w-[1px] bg-sidebar-border" />
                        <ServerControl
                            projectPath={project?.localPath}
                            storedDevCommand={storedFrameworkInfo?.devCommand}
                            storedDevPort={storedFrameworkInfo?.devPort}
                        />
                    </div>
                </div>
            </TooltipProvider>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex flex-col">
                {routes.length === 0 ? (
                    /* Empty State */
                    <div className="flex-1 overflow-y-auto p-6 pt-16">
                        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8.5rem)] text-muted-foreground border-2 border-dashed border-border/50 rounded-xl bg-muted/5">
                            <FileText className="h-10 w-10 mb-3 opacity-20" />
                            <p>No pages detected in this project.</p>
                            <p className="text-xs mb-4">Supports Next.js, Remix, SvelteKit, Nuxt, Astro, and more</p>

                            <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                    if (!project?.localPath) return
                                    setIsScanningAI(true)
                                    try {
                                        // AI scanning would go here
                                        await refreshRoutes()
                                    } finally {
                                        setIsScanningAI(false)
                                    }
                                }}
                                disabled={isScanningAI}
                            >
                                {isScanningAI ? (
                                    <>Scanning...</>
                                ) : (
                                    <>
                                        <Sparkles className="h-3.5 w-3.5 mr-2 text-purple-500" />
                                        Scan with AI
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                ) : focusedPageIndex !== null && focusedRoute ? (
                    /* Focused/Slide View */
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0 pt-9 bg-sidebar/60">
                        {/* Preview area */}
                        <div className="flex-1 flex items-center justify-center min-h-0 pt-4 px-4 pb-4">
                            <div
                                className={cn(
                                    "relative bg-card overflow-hidden transition-all duration-300 shadow-xl rounded-xl border border-border/40",
                                    device === 'desktop' ? "w-full h-full" : "h-full",
                                    device === 'mobile' && "w-[375px]",
                                    device === 'tablet' && "w-[768px]"
                                )}
                                style={{
                                    transform: `scale(${zoom / 100})`,
                                    transformOrigin: 'center center'
                                }}
                            >
                                {serverStatus === 'running' && serverPort ? (
                                    <iframe
                                        ref={iframeRef}
                                        src={`http://localhost:${serverPort}${focusedRoute.path}`}
                                        className="w-full h-full border-none"
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <AppWindow className="h-16 w-16 mb-4 opacity-20" />
                                        <p className="text-lg">Start dev server for live preview</p>
                                        <p className="text-sm text-muted-foreground/60 mt-1">{focusedRoute.path}</p>
                                    </div>
                                )}

                                {/* Dynamic badge */}
                                {focusedRoute.type === 'dynamic' && (
                                    <div className="absolute top-3 right-3 px-2 py-1 rounded text-xs uppercase font-bold tracking-wider bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                        Dynamic
                                    </div>
                                )}

                                {/* Action buttons overlay */}
                                <div className="absolute bottom-4 right-4 flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleOpenCode(focusedRoute.file)}
                                        className="shadow-md"
                                    >
                                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                                        Edit Code
                                    </Button>
                                    {serverStatus === 'running' && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => window.open(`http://localhost:${serverPort}${focusedRoute.path}`, '_blank')}
                                            className="shadow-md"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                                            Open
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Thumbnail strip */}
                        <div className="shrink-0 bg-sidebar/60 backdrop-blur-md px-3 py-2">
                            <div className="flex items-center gap-3">
                                <div
                                    ref={thumbnailStripRef}
                                    className="flex-1 flex gap-2 overflow-x-auto pb-0.5 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent"
                                >
                                    {routes.map((route, index) => (
                                        <button
                                            key={route.path}
                                            onClick={() => setFocusedPageIndex(index)}
                                            className={cn(
                                                "shrink-0 flex flex-col items-center gap-1 transition-all",
                                                index === focusedPageIndex
                                                    ? "opacity-100"
                                                    : "opacity-50 hover:opacity-100"
                                            )}
                                        >
                                            <div className={cn(
                                                "w-24 h-14 rounded border-2 overflow-hidden",
                                                index === focusedPageIndex
                                                    ? "border-primary ring-1 ring-primary/20"
                                                    : "border-border/40 hover:border-border"
                                            )}>
                                                {serverStatus === 'running' && serverPort ? (
                                                    <div className="w-full h-full bg-white relative">
                                                        <iframe
                                                            src={`http://localhost:${serverPort}${route.path}`}
                                                            className="w-[500%] h-[500%] origin-top-left scale-[0.20] border-none pointer-events-none"
                                                            tabIndex={-1}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="w-full h-full bg-muted/50 flex items-center justify-center">
                                                        <AppWindow className="h-3 w-3 text-muted-foreground/30" />
                                                    </div>
                                                )}
                                            </div>
                                            <span className={cn(
                                                "text-[10px] max-w-24 truncate",
                                                index === focusedPageIndex
                                                    ? "text-foreground font-medium"
                                                    : "text-muted-foreground"
                                            )}>
                                                {route.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {focusedPageIndex !== null && (
                                        <span>{focusedPageIndex + 1}/{routes.length}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Grid View */
                    <div className="flex-1 overflow-y-auto p-6 pt-16 bg-sidebar/60">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {routes.map((route, index) => (
                                <div key={route.path} className="group relative">
                                    <Card
                                        className="group relative overflow-hidden border-border/40 bg-card/50 hover:bg-card hover:border-sidebar-primary/20 transition-all duration-300 shadow-sm hover:shadow-md h-[220px] flex flex-col cursor-pointer"
                                        onClick={() => setFocusedPageIndex(index)}
                                    >
                                        {/* Preview Area */}
                                        <div className="flex-1 bg-muted/20 relative flex flex-col items-center justify-center overflow-hidden">
                                            {serverStatus === 'running' && serverPort ? (
                                                <div className="absolute inset-0 z-10">
                                                    <div className="w-full h-full bg-white relative overflow-hidden">
                                                        <iframe
                                                            src={`http://localhost:${serverPort}${route.path}`}
                                                            className="w-[200%] h-[200%] origin-top-left scale-50 border-none pointer-events-none select-none block"
                                                            tabIndex={-1}
                                                        />
                                                        <div className="absolute inset-0 bg-transparent" />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-center p-4">
                                                    <AppWindow className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                                                    <span className="text-xs text-muted-foreground/40 font-medium">Start server to preview</span>
                                                </div>
                                            )}

                                            {/* Dynamic Label */}
                                            {route.type === 'dynamic' && (
                                                <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/10 backdrop-blur-sm">
                                                    Dynamic
                                                </div>
                                            )}

                                            {/* Hover Overlay Actions */}
                                            <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0 z-20">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="h-7 text-[10px] px-2 shadow-sm bg-background/80 backdrop-blur-sm hover:bg-background"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleOpenCode(route.file)
                                                    }}
                                                >
                                                    <FileText className="h-3 w-3 mr-1.5" />
                                                    Edit
                                                </Button>

                                                {serverStatus === 'running' && (
                                                    <Button
                                                        variant="secondary"
                                                        size="icon"
                                                        className="h-7 w-7 shadow-sm bg-background/80 backdrop-blur-sm hover:bg-background"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            window.open(`http://localhost:${serverPort}${route.path}`, '_blank')
                                                        }}
                                                    >
                                                        <ExternalLink className="h-3 w-3" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>

                                        {/* Footer Info */}
                                        <div className="px-3 py-2.5 border-t border-border/40 bg-card/30 backdrop-blur-[2px]">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-medium text-sm text-foreground/90 truncate" title={route.path}>
                                                    {route.name}
                                                </h3>
                                                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 truncate max-w-[40%] text-right bg-muted/50 px-1.5 py-0.5 rounded">
                                                    {route.path}
                                                </span>
                                            </div>
                                            {route.description && (
                                                <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {route.description}
                                                </p>
                                            )}
                                        </div>
                                    </Card>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Terminal Panel */}
            {project?.localPath && (
                <TerminalPanel projectPath={project.localPath} />
            )}
        </div>
    )
}
