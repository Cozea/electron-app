import { Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"

interface LoginFormProps extends React.ComponentProps<"div"> {
  onLogin: () => void
  isLoading: boolean
}

export function LoginForm({
  className,
  onLogin,
  isLoading,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex flex-col items-center gap-2 font-medium">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-6" />
            </div>
          </div>
          <h1 className="text-xl font-bold">Welcome to Cozea</h1>
          <FieldDescription>Sign in to continue</FieldDescription>
        </div>
        <Button
          onClick={onLogin}
          disabled={isLoading}
          size="lg"
          className="w-full"
        >
          {isLoading ? "Signing in..." : "Sign in"}
        </Button>
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Terms of Service
        </a>{" "}
        and{" "}
        <a href="#" className="underline underline-offset-4 hover:text-primary">
          Privacy Policy
        </a>
        .
      </FieldDescription>
    </div>
  )
}
