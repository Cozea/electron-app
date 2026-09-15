import type { ComponentType, SVGProps } from 'react'
import {
  SiClion,
  SiDatagrip,
  SiGoland,
  SiIntellijidea,
  SiPhpstorm,
  SiPycharm,
  SiRider,
  SiRubymine,
  SiWebstorm,
} from 'react-icons/si'
import { VscVscodeInsiders } from 'react-icons/vsc'
import { HugeiconsIcon } from '@hugeicons/react'
import { CodeCircleIcon as __Code2HugeIcon } from '@hugeicons/core-free-icons'
import type { ExternalEditorId } from '@shared/electronApiTypes'

import {
  AntigravityIcon,
  CursorIcon,
  FinderIcon,
  VisualStudioCodeIcon,
  ZedIcon,
} from '@/components/EditorBrandIcons'

export type EditorIconComponent = ComponentType<SVGProps<SVGSVGElement>>

export const GenericCodeIcon: EditorIconComponent = ({ strokeWidth: _strokeWidth, ...props }) => (
  <HugeiconsIcon icon={__Code2HugeIcon} {...props} />
)

export function getExternalEditorIcon(editorId: ExternalEditorId): EditorIconComponent {
  switch (editorId) {
    case 'vscode':
    case 'vscodium':
      return VisualStudioCodeIcon
    case 'vscode-insiders':
      return VscVscodeInsiders
    case 'zed':
      return ZedIcon
    case 'webstorm':
      return SiWebstorm
    case 'intellij-idea':
      return SiIntellijidea
    case 'phpstorm':
      return SiPhpstorm
    case 'pycharm':
      return SiPycharm
    case 'rider':
      return SiRider
    case 'goland':
      return SiGoland
    case 'rubymine':
      return SiRubymine
    case 'clion':
      return SiClion
    case 'datagrip':
      return SiDatagrip
    case 'cursor':
      return CursorIcon
    case 'antigravity':
      return AntigravityIcon
    case 'finder':
      return FinderIcon
    case 'windsurf':
    default:
      return GenericCodeIcon
  }
}

export function getExternalEditorKind(editorId: ExternalEditorId): 'brand' | 'generic' {
  switch (editorId) {
    case 'finder':
      return 'generic'
    default:
      return 'brand'
  }
}
