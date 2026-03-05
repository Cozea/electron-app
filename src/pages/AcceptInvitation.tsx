import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { AlertCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'

export function AcceptInvitation() {
  const navigate = useViewTransitionNavigate()
  const { token } = useParams<{ token: string }>()

  const shortToken = useMemo(() => {
    if (!token) return null
    if (token.length <= 12) return token
    return `${token.slice(0, 6)}…${token.slice(-4)}`
  }, [token])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <CardTitle>Invitation Link Retired</CardTitle>
          <CardDescription>
            Workspace membership is now managed directly by WorkOS invitation emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This legacy token flow is disabled. Ask a workspace admin to resend your invitation from
            the members page, then accept it from the WorkOS email.
          </p>
          {shortToken ? (
            <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Token: {shortToken}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => navigate('/')} className="flex-1">
              Go to Dashboard
            </Button>
            <Button variant="outline" onClick={() => navigate('/settings')} className="flex-1">
              Open Team Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
