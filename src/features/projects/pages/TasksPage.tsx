import { SplitSquareHorizontal } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyContent,
  EmptyTitle,
} from '@/components/ui/empty'

export function TasksPage() {
  return (
    <div className="flex flex-col h-full bg-[var(--sidebar)]">
      {/* Fixed Header */}
      <div className="flex-none flex items-center justify-between px-4 pt-4 pb-4 bg-[var(--sidebar)] z-20">
        <h1 className="text-sm font-medium">Tasks</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md w-full p-12 border-0 bg-sidebar/50 shadow-none">
          <Empty className="py-0">
            <EmptyHeader>
              <EmptyMedia>
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4 mx-auto text-primary">
                  <SplitSquareHorizontal className="w-8 h-8" />
                </div>
              </EmptyMedia>
              <EmptyTitle className="text-xl font-semibold mb-2">Integrated Task Board</EmptyTitle>
              <EmptyDescription className="text-base leading-relaxed">
                A powerful new way to track your project progress is on the way. The upcoming task system will feature:
              </EmptyDescription>
              <EmptyContent className="text-sm text-left px-8 space-y-3">
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Context-aware task lists pinned to specific pages</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>One-click claiming by AI or teammates</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>Live status updates and ownership tracking</span>
                </div>
              </EmptyContent>
            </EmptyHeader>
          </Empty>
        </Card>
      </div>
    </div>
  )
}
