import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Logo } from "@/components/Logo"

import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

interface LoginFormProps extends React.ComponentProps<"div"> {
  onLogin: () => void
  isLoading: boolean
  errorMessage?: string | null
}

export function LoginForm({
  className,
  onLogin,
  isLoading,
  errorMessage,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={48} />
          <h1 className="text-xl font-bold">Welcome to Cozea</h1>
          <FieldDescription>Initialize this device to continue</FieldDescription>
        </div>
        <Button
          onClick={onLogin}
          disabled={isLoading}
          size="lg"
          className="w-full"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <HugeiconsIcon icon={__Loader2HugeIcon} className="size-4 animate-spin" />
              Preparing device...
            </>
          ) : (
            "Continue on this device"
          )}
        </Button>
        {errorMessage ? (
          <FieldDescription className="text-center text-sm text-destructive" role="alert">
            {errorMessage}
          </FieldDescription>
        ) : null}
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        Cozea uses a local trusted device identity by default. Collaboration access is granted per project.
      </FieldDescription>
    </div>
  )
}
