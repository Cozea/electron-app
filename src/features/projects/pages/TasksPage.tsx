import tasksComingSoonImage from '@/assets/tasks-coming-soon.png'
import { Card } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyContent,
  EmptyTitle,
} from '@/components/ui/empty'

export function TasksPage() {
  return (
    <div className="flex flex-col h-full bg-content-surface">
      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-5xl w-full p-12 border-0 bg-content-surface shadow-none">
          <Empty className="py-0">
            <EmptyHeader className="gap-0">
              <img
                src={tasksComingSoonImage}
                alt="Tasks coming soon"
                className="w-[400px] max-w-[72vw] h-auto mb-0 mx-auto"
              />
              <EmptyTitle className="text-xl font-semibold mb-1">Integrated Task Board</EmptyTitle>
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
