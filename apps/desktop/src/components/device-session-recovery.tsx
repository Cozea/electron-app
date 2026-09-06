import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Logo } from "@/components/Logo"
import { useTranslation } from "@/lib/i18n"

interface DeviceSessionRecoveryFormProps extends React.ComponentProps<"div"> {
  onRetry: () => void
  isLoading: boolean
  errorMessage?: string | null
}

export function DeviceSessionRecoveryForm({
  className,
  onRetry,
  isLoading,
  errorMessage,
  ...props
}: DeviceSessionRecoveryFormProps) {
  const { t } = useTranslation()

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={48} />
          <h1 className="text-xl font-bold">{t("deviceSession.welcome")}</h1>
          <FieldDescription>{t("deviceSession.initializeDevice")}</FieldDescription>
        </div>
        <Button
          onClick={onRetry}
          disabled={isLoading}
          size="lg"
          className="w-full"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <div className="loader" />
              {t("deviceSession.preparingDevice")}
            </>
          ) : (
            t("deviceSession.continueOnDevice")
          )}
        </Button>
        {errorMessage ? (
          <FieldDescription className="text-center text-sm text-destructive" role="alert">
            {errorMessage}
          </FieldDescription>
        ) : null}
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        {t("deviceSession.localIdentityNote")}
      </FieldDescription>
    </div>
  )
}
