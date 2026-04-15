

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'

import { HugeiconsIcon } from '@hugeicons/react'
import { LockIcon as __LockHugeIcon } from '@hugeicons/core-free-icons'

interface WorkspaceAccessNoticeProps {
  title: string
  description: string
}

export function WorkspaceAccessNotice({
  title,
  description,
}: WorkspaceAccessNoticeProps) {
  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardContent className="px-0 pt-0">
        <div className="rounded-2xl bg-secondary/80 p-6 dark:bg-secondary/40">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/70">
              <HugeiconsIcon icon={__LockHugeIcon} className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg">{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

