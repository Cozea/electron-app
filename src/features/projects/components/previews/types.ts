import type { CompactPresenceUser } from '@/components/presence/CompactPresenceIndicator'
import type { PageRoute } from '@/stores/useProjectPagesStore'

export interface PreviewRouteViewModel {
  fallbackPreviewImageUrl: string | null
  presenceUsers: CompactPresenceUser[]
  previewImageUrl: string | null
  previewUrl: string | null
  route: PageRoute
}

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile'
