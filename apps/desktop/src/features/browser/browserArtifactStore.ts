import type {
  DesktopPreviewRecordingArtifact,
  DesktopPreviewScreenshotArtifact,
} from "@cozea/contracts/t3/ipc"
import { create } from "zustand"

interface BrowserArtifactStoreState {
  readonly screenshotByTabId: Record<string, DesktopPreviewScreenshotArtifact>
  readonly recordingByTabId: Record<string, DesktopPreviewRecordingArtifact>
  readonly setScreenshot: (artifact: DesktopPreviewScreenshotArtifact) => void
  readonly setRecording: (artifact: DesktopPreviewRecordingArtifact) => void
}

export const useBrowserArtifactStore = create<BrowserArtifactStoreState>()((set) => ({
  screenshotByTabId: {},
  recordingByTabId: {},
  setScreenshot: (artifact) =>
    set((state) => ({
      screenshotByTabId: { ...state.screenshotByTabId, [artifact.tabId]: artifact },
    })),
  setRecording: (artifact) =>
    set((state) => ({
      recordingByTabId: { ...state.recordingByTabId, [artifact.tabId]: artifact },
    })),
}))
