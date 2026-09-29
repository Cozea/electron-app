import { createContext, useContext } from "react"

interface HeaderOverflowContextValue {
  dismiss: () => void
  returnFocus: () => HTMLElement | true | undefined
}

export const HeaderOverflowContext = createContext<HeaderOverflowContextValue | null>(null)
export const useHeaderOverflow = () => useContext(HeaderOverflowContext)
