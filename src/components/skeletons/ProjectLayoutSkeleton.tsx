import { Skeleton } from "@/components/ui/skeleton"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export function ProjectLayoutSkeleton() {
    return (
        <SidebarProvider>
            {/* Mock Sidebar */}
            <div className="w-[260px] h-screen border-r bg-sidebar flex flex-col p-4 space-y-4 hidden md:flex">
                <div className="flex items-center gap-2 px-2 py-1">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                </div>
                <div className="space-y-1 pt-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full rounded-md" />
                    ))}
                </div>
            </div>

            <SidebarInset>
                {/* Mock Header */}
                <header className="flex h-14 items-center gap-2 border-b px-4">
                    <Skeleton className="h-4 w-32" />
                    <div className="ml-auto flex items-center gap-2">
                        <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                </header>

                {/* Mock Content */}
                <div className="p-6 space-y-6">
                    <Skeleton className="h-8 w-48" />
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        <Skeleton className="h-32 w-full rounded-xl" />
                        <Skeleton className="h-32 w-full rounded-xl" />
                        <Skeleton className="h-32 w-full rounded-xl" />
                    </div>
                    <Skeleton className="h-64 w-full rounded-xl" />
                </div>
            </SidebarInset>
        </SidebarProvider>
    )
}
