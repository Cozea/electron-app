import { Skeleton } from "@/components/ui/skeleton"

export function ProjectListSkeleton() {
    return (
        <div className="container mx-auto py-8">
            <div className="flex justify-between items-center mb-8">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <Skeleton className="h-10 w-32" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="border rounded-lg p-6 space-y-4">
                        <div className="flex justify-between items-start">
                            <Skeleton className="h-12 w-12 rounded-lg" />
                            <Skeleton className="h-6 w-6 rounded-full" />
                        </div>
                        <div className="space-y-2">
                            <Skeleton className="h-6 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-2/3" />
                        </div>
                        <div className="pt-4 flex items-center gap-2">
                            <Skeleton className="h-8 w-20 rounded-full" />
                            <Skeleton className="h-4 w-24 ml-auto" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
