import { TitleBar } from '../TitleBar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

interface PublicLayoutProps {
  children: React.ReactNode
  title?: string
  description?: string
  showCard?: boolean
}

export function PublicLayout({
  children,
  title,
  description,
  showCard = true
}: PublicLayoutProps) {
  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      <TitleBar />

      <main className="flex-1 flex items-center justify-center p-4 pt-14">
        {showCard ? (
          <Card className="w-full max-w-md">
            {(title || description) && (
              <CardHeader className="text-center">
                {title && <CardTitle className="text-2xl">{title}</CardTitle>}
                {description && (
                  <CardDescription>{description}</CardDescription>
                )}
              </CardHeader>
            )}
            <CardContent>
              {children}
            </CardContent>
          </Card>
        ) : (
          <div className="w-full max-w-md text-center">
            {children}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-sm text-muted-foreground">
        Cozea v0.1.0
      </footer>
    </div>
  )
}
