import { useState, useEffect, type MouseEvent } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { scanForRoutes, type ScannedRoute } from "@/utils/routeScanner"
import { getFileIcon } from "@/lib/fileExplorer/fileIcons"
import { FileText, Loader2, RefreshCw, ExternalLink, AppWindow } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useProjectPagesStore } from "@/stores/useProjectPagesStore"
import { useOptionalProjectSyncContext } from "../contexts/ProjectSyncContext"

export function PagesList() {
    const { slug } = useParams<{ slug: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const { currentOrganization } = useAuth()
    const { serverStatus, serverPort } = useProjectPagesStore()
    const syncContext = useOptionalProjectSyncContext()
    const projectPath = syncContext?.projectPath ?? null

    // Get the focused page index from URL
    const focusParam = searchParams.get('focus')
    const focusedIndex = focusParam !== null ? parseInt(focusParam, 10) : null

    const [routes, setRoutes] = useState<ScannedRoute[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [framework, setFramework] = useState<string | null>(null)

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

    // Extract stored framework info
    const storedFrameworkInfo = project?.frameworkInfo ? {
        framework: project.frameworkInfo.framework,
        devCommand: project.frameworkInfo.devCommand,
        devPort: project.frameworkInfo.devPort,
    } : null

    const refreshRoutes = async () => {
        if (!projectPath) return

        setIsLoading(true)
        try {
            const result = await scanForRoutes(projectPath, storedFrameworkInfo)
            setRoutes(result.routes)
            setFramework(result.framework)
        } catch (error) {
            console.error('Failed to scan routes:', error)
        } finally {
            setIsLoading(false)
        }
    }

    // Scan routes when project loads
    useEffect(() => {
        if (projectPath) {
            refreshRoutes()
        }
    }, [projectPath])

    const handlePageClick = (index: number) => {
        // Navigate to the pages view with this route focused
        navigate(`/projects/${slug}/pages?focus=${index}`)
    }

    const handleOpenInBrowser = (e: MouseEvent, route: ScannedRoute) => {
        e.stopPropagation()
        if (serverStatus === 'running' && serverPort) {
            window.open(`http://localhost:${serverPort}${route.path}`, '_blank')
        }
    }

    if (project === undefined) {
        return (
            <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full">


            {/* Routes list */}
            <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                ) : routes.length === 0 ? (
                    <div className="p-4 text-center">
                        <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                        <p className="text-xs text-muted-foreground">No pages detected</p>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={refreshRoutes}
                            className="mt-2 h-7 text-xs"
                        >
                            <RefreshCw className="h-3 w-3 mr-1.5" />
                            Scan
                        </Button>
                    </div>
                ) : (
                    <div className="py-1">
                        {routes.map((route, index) => {
                            const isActive = focusedIndex === index
                            return (
                            <div
                                key={route.path}
                                onClick={() => handlePageClick(index)}
                                className={cn(
                                    "flex items-center gap-2 mx-2 px-2 h-8 text-left cursor-pointer rounded-md",
                                    "hover:bg-sidebar-accent transition-colors text-sm",
                                    "group",
                                    isActive && "bg-sidebar-accent"
                                )}
                            >
                                <AppWindow className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0 truncate">
                                    {route.name}
                                </div>
                                {route.type === 'dynamic' && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 shrink-0">
                                        Dynamic
                                    </span>
                                )}
                                {serverStatus === 'running' && (
                                    <button
                                        onClick={(e) => handleOpenInBrowser(e, route)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-sidebar-accent rounded"
                                        title="Open in browser"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Footer with route count */}
            {routes.length > 0 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {framework && getFileIcon(
                            framework.toLowerCase().includes('vite') ? 'vite.config.js' :
                                framework.toLowerCase().includes('next') ? 'next.config.js' :
                                    framework.toLowerCase().includes('astro') ? 'astro.config.mjs' :
                                        framework.toLowerCase().includes('remix') ? 'remix.config.js' :
                                            framework.toLowerCase().includes('nuxt') ? 'nuxt.config.ts' :
                                                framework.toLowerCase().includes('svelte') ? 'svelte.config.js' :
                                                    framework.toLowerCase().includes('react') ? 'App.tsx' :
                                                        framework.toLowerCase().includes('vue') ? 'App.vue' :
                                                            'package.json',
                            { className: "h-3.5 w-3.5" }
                        )}
                        <span>{routes.length} page{routes.length !== 1 ? 's' : ''}</span>
                    </div>
                    <button
                        onClick={refreshRoutes}
                        disabled={isLoading}
                        className="hover:text-foreground transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
                    </button>
                </div>
            )}
        </div>
    )
}
