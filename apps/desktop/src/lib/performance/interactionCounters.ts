export interface InteractionCounters {
  syntheticResizeEvents: number
  sidebarWidthStoreWrites: number
  changesSidebarStoreWrites: number
  browserGeometryPublishes: number
  browserPresentationStoreWrites: number
  terminalFitCalls: number
  terminalPtyResizeSends: number
}

export interface InteractionCountersApi {
  get(): InteractionCounters
  reset(): void
  increment(key: keyof InteractionCounters): void
}

declare global {
  interface Window {
    __cozeaInteractionCounters?: InteractionCountersApi
  }
}

const counters: InteractionCounters = {
  syntheticResizeEvents: 0,
  sidebarWidthStoreWrites: 0,
  changesSidebarStoreWrites: 0,
  browserGeometryPublishes: 0,
  browserPresentationStoreWrites: 0,
  terminalFitCalls: 0,
  terminalPtyResizeSends: 0,
}

let isInitialized = false

export function initInteractionCounters(): void {
  if (isInitialized) return
  isInitialized = true

  const api: InteractionCountersApi = {
    get: () => ({ ...counters }),
    reset: () => {
      counters.syntheticResizeEvents = 0
      counters.sidebarWidthStoreWrites = 0
      counters.changesSidebarStoreWrites = 0
      counters.browserGeometryPublishes = 0
      counters.browserPresentationStoreWrites = 0
      counters.terminalFitCalls = 0
      counters.terminalPtyResizeSends = 0
    },
    increment: (key) => {
      counters[key]++
    },
  }

  if (typeof window !== "undefined") {
    window.__cozeaInteractionCounters = api
    window.addEventListener("resize", (event) => {
      if (!event.isTrusted) {
        counters.syntheticResizeEvents++
      }
    })
  }
}

export function recordInteractionCounter(key: keyof InteractionCounters): void {
  if (typeof window !== "undefined" && window.__cozeaInteractionCounters) {
    window.__cozeaInteractionCounters.increment(key)
  }
}
