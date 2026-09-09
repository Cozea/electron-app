/**
 * Restart requests for the first-run product tour.
 *
 * The tour normally runs itself once and then stays quiet forever, which makes
 * it awkward to look at while it is being built. Anything may ask for a rerun,
 * so the request cannot live inside the component that renders the tour.
 *
 * The counter is the signal: each call is a distinct request, so asking twice
 * in a row restarts twice rather than being swallowed as an unchanged value.
 */

import { create } from "zustand"

interface ProductTourState {
  /**
   * True while the tutorial is on screen. Surfaces that offer several ways to
   * do something read this and allow only the one the tutorial is teaching, so
   * a stray choice cannot strand the user mid-tour.
   */
  isActive: boolean
  setActive: (active: boolean) => void
  restartRequest: number
  requestRestart: () => void
}

export const useProductTourStore = create<ProductTourState>((set) => ({
  isActive: false,
  setActive: (active) => set({ isActive: active }),
  restartRequest: 0,
  requestRestart: () => set((state) => ({ restartRequest: state.restartRequest + 1 })),
}))
