import { Database } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyContent,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

export function ProjectDatabasePage() {
  return (
    <div className="flex flex-col h-full bg-[var(--sidebar)]">
      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-12 border-0 bg-sidebar/50 shadow-none">
          <Empty className="py-0">
            <EmptyHeader>
              <EmptyMedia>
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 mx-auto text-primary">
                  <Database className="w-8 h-8" />
                </div>
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold mb-2">Database Studio Coming Soon</EmptyTitle>
              <EmptyDescription className="text-base leading-relaxed">
                We are reimagining the database experience for vibecoders.
              </EmptyDescription>
              <EmptyContent className="text-sm text-left px-8 space-y-3">
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Advanced schema visualization</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Direct data editing & migration tools</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Seamless connections to Firebase, Supabase, Convex, and more</span>
                </div>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        </Card>
      </div>
    </div>
  )
}
