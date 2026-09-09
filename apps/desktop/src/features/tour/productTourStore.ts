/**
 * Whether the first-run tour is on screen.
 *
 * Surfaces that offer several ways to do something read this and allow only the
 * one the tutorial is teaching, so a stray choice cannot strand the user. The
 * request cannot live inside the component that renders the tour, because the
 * menus asking are nowhere near it.
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
}

export const useProductTourStore = create<ProductTourState>((set) => ({
  isActive: false,
  setActive: (active) => set({ isActive: active }),
}))
