import { useAuth } from "../contexts/AuthContext"
import { DeviceSessionRecoveryForm } from "@/components/device-session-recovery"

export function DeviceSessionRecovery() {
  const { retryDeviceSession, isLoading, authError } = useAuth()

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <DeviceSessionRecoveryForm onRetry={retryDeviceSession} isLoading={isLoading} errorMessage={authError} />
      </div>
    </div>
  )
}
