import { ConvexReactClient } from "convex/react"

const convexUrl = import.meta.env.VITE_CONVEX_URL

if (!convexUrl) {
  console.warn("VITE_CONVEX_URL not set - Convex features will be disabled")
}

export const convex = convexUrl ? new ConvexReactClient(convexUrl) : null
