import type { ComponentType } from "react"

import { GlobeAltIcon as Globe } from "@heroicons/react/24/outline"
import { FaBrave, FaChrome, FaEdge, FaFirefoxBrowser, FaSafari } from "react-icons/fa6"
import { TbBrandArc } from "react-icons/tb"

import type { AvailableExternalBrowser, ExternalBrowserId } from "@shared/electronApiTypes"

export const PREVIEW_BROWSER_PREFERENCE_KEY = "cozea.preview.browser"
export const PREVIEW_DESTINATION_PREFERENCE_KEY = "cozea.preview.destination"

export type PreviewDestination = "cozea" | "external"

const SUPPORTED_EXTERNAL_BROWSER_IDS: ExternalBrowserId[] = [
  "system",
  "safari",
  "chrome",
  "arc",
  "firefox",
  "edge",
  "brave",
]

export function readStoredExternalBrowserPreference(): ExternalBrowserId {
  try {
    const stored = window.localStorage.getItem(PREVIEW_BROWSER_PREFERENCE_KEY)
    return SUPPORTED_EXTERNAL_BROWSER_IDS.includes(stored as ExternalBrowserId)
      ? (stored as ExternalBrowserId)
      : "system"
  } catch {
    return "system"
  }
}

export function readStoredPreviewDestinationPreference(): PreviewDestination {
  try {
    return window.localStorage.getItem(PREVIEW_DESTINATION_PREFERENCE_KEY) === "external"
      ? "external"
      : "cozea"
  } catch {
    return "cozea"
  }
}

export function resolvePreferredExternalBrowserId(
  availableBrowsers: AvailableExternalBrowser[],
  preferredBrowserId: ExternalBrowserId
): ExternalBrowserId {
  if (availableBrowsers.some((browser) => browser.id === preferredBrowserId)) {
    return preferredBrowserId
  }

  return availableBrowsers[0]?.id ?? "system"
}

export function getVisibleExternalBrowsers(
  availableBrowsers: AvailableExternalBrowser[],
  defaultBrowserId: ExternalBrowserId
): AvailableExternalBrowser[] {
  if (defaultBrowserId === "system") {
    return availableBrowsers
  }

  return availableBrowsers.filter((browser) => browser.id !== "system")
}

export function getEffectiveExternalBrowserId(
  selectedBrowserId: ExternalBrowserId,
  defaultBrowserId: ExternalBrowserId
): ExternalBrowserId {
  return selectedBrowserId === "system" ? defaultBrowserId : selectedBrowserId
}

export function getExternalBrowserIcon(
  browserId: ExternalBrowserId
): ComponentType<{ className?: string }> {
  switch (browserId) {
    case "chrome":
      return FaChrome
    case "arc":
      return TbBrandArc
    case "firefox":
      return FaFirefoxBrowser
    case "edge":
      return FaEdge
    case "brave":
      return FaBrave
    case "safari":
      return FaSafari
    case "system":
    default:
      return Globe
  }
}
