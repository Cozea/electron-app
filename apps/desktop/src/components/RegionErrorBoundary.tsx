import { Component, type ReactNode } from "react"

import { AppErrorScreen } from "@/components/AppErrorScreen"
import { Button } from "@/components/ui/button"
import { getStoredLanguage, getTranslation } from "@/lib/i18n"

interface RegionErrorBoundaryProps {
  children: ReactNode
  /**
   * A one-line fallback for narrow regions (the header, the sidebar), where
   * the full error screen does not fit.
   */
  compact?: boolean
}

/**
 * Contains a crash to one region of the shell. Without these, an error in the
 * header, the sidebar or the workbench reached the route boundary and replaced
 * the whole window, sidebar included, leaving only "Reload app".
 */
export class RegionErrorBoundary extends Component<RegionErrorBoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown) {
    console.error("[RegionErrorBoundary]", error)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (!this.props.compact) {
      return <AppErrorScreen error={this.state.error} reset={this.reset} />
    }
    const lang = getStoredLanguage()
    return (
      <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{getTranslation(lang, "errorScreen.title")}</span>
        <Button variant="outline" size="sm" onClick={this.reset}>
          {getTranslation(lang, "errorScreen.tryAgain")}
        </Button>
      </div>
    )
  }
}
