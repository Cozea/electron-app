import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Logo } from "@/components/Logo"
import { useTranslation } from "@/lib/i18n"

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
  const { t } = useTranslation()

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={48} />
          <h1 className="text-xl font-bold">{t("login.welcome")}</h1>
          <FieldDescription>{t("login.initializeDevice")}</FieldDescription>
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
              <div className="loader" />
              {t("login.preparingDevice")}
            </>
          ) : (
            t("login.continueOnDevice")
          )}
        </Button>
        {errorMessage ? (
          <FieldDescription className="text-center text-sm text-destructive" role="alert">
            {errorMessage}
          </FieldDescription>
        ) : null}
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        {t("login.localIdentityNote")}
      </FieldDescription>
    </div>
  )
}
