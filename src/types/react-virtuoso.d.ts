declare module 'react-virtuoso' {
  import * as React from 'react'

  export interface VirtuosoProps<T> {
    data?: readonly T[]
    defaultItemHeight?: number
    increaseViewportBy?: number | { top?: number; bottom?: number }
    customScrollParent?: HTMLElement
    style?: React.CSSProperties
    computeItemKey?: (index: number, item: T) => React.Key
    itemContent: (index: number, item: T) => React.ReactNode
  }

  export function Virtuoso<T>(props: VirtuosoProps<T>): React.ReactElement
}
