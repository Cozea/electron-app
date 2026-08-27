import { toastManager } from "@/features/projects/components/assistant/ui/toast"

type AppToastInput = {
  title: string
  description?: string
}

/** Non-blocking feedback for user-initiated actions. Pass already-translated strings. */
export const appToast = {
  error({ title, description }: AppToastInput) {
    toastManager.add({ type: "error", title, description })
  },
  warning({ title, description }: AppToastInput) {
    toastManager.add({ type: "warning", title, description })
  },
  success({ title, description }: AppToastInput) {
    toastManager.add({ type: "success", title, description })
  },
  info({ title, description }: AppToastInput) {
    toastManager.add({ type: "info", title, description })
  },
}
