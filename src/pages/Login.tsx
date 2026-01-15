import { useAuth } from "../contexts/AuthContext"
import { LoginForm } from "@/components/login-form"

export function Login() {
  const { login, isLoading } = useAuth()

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm onLogin={login} isLoading={isLoading} />
      </div>
    </div>
  )
}
