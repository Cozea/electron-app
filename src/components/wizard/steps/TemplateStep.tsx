import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2 } from 'lucide-react'

interface TemplateStepProps {
  selected: string
  onSelect: (template: string) => void
  projectDescription?: string
}

export function TemplateStep({ selected, onSelect, projectDescription }: TemplateStepProps) {
  const templates = useQuery(api.projectTemplates.list)

  if (!templates) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Group templates by category
  const categories = templates.reduce(
    (acc, template) => {
      if (!acc[template.category]) {
        acc[template.category] = []
      }
      acc[template.category].push(template)
      return acc
    },
    {} as Record<string, typeof templates>
  )

  const categoryOrder = ['starter', 'business', 'content', 'social', 'productivity', 'marketing']

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Choose a starting point</h2>
        <p className="text-muted-foreground">
          Templates provide starting pages and data models. You can customize everything after generation.
        </p>
      </div>

      {/* Recommended section */}
      {projectDescription && templates.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Recommended for you</h3>
          <Card
            className={`cursor-pointer transition-all ${
              selected === templates[0]?.slug
                ? 'border-primary bg-primary/5'
                : 'hover:border-primary/50'
            }`}
            onClick={() => onSelect(templates[0]?.slug || '')}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{templates[0]?.icon}</span>
                  <CardTitle className="text-base">{templates[0]?.name}</CardTitle>
                </div>
                {selected === templates[0]?.slug && (
                  <Check className="h-5 w-5 text-primary" />
                )}
              </div>
              <CardDescription>{templates[0]?.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <Badge variant="secondary" className="text-xs">
                {templates[0]?.pageCount} pages
              </Badge>
            </CardContent>
          </Card>
        </div>
      )}

      {/* All templates by category */}
      <div className="space-y-6">
        <h3 className="text-sm font-medium text-muted-foreground">All Templates</h3>

        {categoryOrder.map((category) => {
          const categoryTemplates = categories[category]
          if (!categoryTemplates?.length) return null

          return (
            <div key={category} className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {category}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {categoryTemplates.map((template) => (
                  <Card
                    key={template.slug}
                    className={`cursor-pointer transition-all ${
                      selected === template.slug
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() => onSelect(template.slug)}
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-lg">{template.icon}</span>
                        {selected === template.slug && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{template.name}</p>
                        <p className="text-xs text-muted-foreground">{template.pageCount} pages</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
