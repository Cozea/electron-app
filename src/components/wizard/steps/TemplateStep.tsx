import {
    IconBrandNextjs,
    IconBrandReact,
    IconBrandNodejs,
    IconAtom,
    IconBrandAppleFilled,
    IconBrandAndroid,
    IconBrandWindowsFilled,
    IconBrandUbuntu,
    IconWorld,
    IconApi
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface TemplateStepProps {
    selected: string
    onSelect: (template: string) => void
}

const PLATFORM_ICONS: Record<string, React.ElementType> = {
    web: IconWorld,
    ios: IconBrandAppleFilled,
    android: IconBrandAndroid,
    mac: IconBrandAppleFilled,
    win: IconBrandWindowsFilled,
    linux: IconBrandUbuntu,
    api: IconApi
}

const TEMPLATES = [
    {
        id: 'nextjs-webapp',
        name: 'Next.js',
        description: 'Full-stack React with SSR',
        icon: IconBrandNextjs,
        platforms: ['web'],
    },
    {
        id: 'react-spa',
        name: 'React SPA',
        description: 'Vite + React Router',
        icon: IconBrandReact,
        platforms: ['web'],
    },
    {
        id: 'node-api',
        name: 'Node API',
        description: 'Express + OpenAPI',
        icon: IconBrandNodejs,
        platforms: ['api'],
    },
    {
        id: 'electron-desktop',
        name: 'Electron',
        description: 'Cross-platform desktop',
        icon: IconAtom,
        platforms: ['mac', 'win', 'linux'],
    },
    {
        id: 'react-native',
        name: 'React Native',
        description: 'iOS & Android with Expo',
        icon: IconBrandReact,
        platforms: ['ios', 'android'],
    }
]

export function TemplateStep({ selected, onSelect }: TemplateStepProps) {
    return (
        <div className="grid grid-cols-4 grid-rows-2 gap-0 h-[calc(100vh-280px)] max-h-[500px]">
            {TEMPLATES.map((template) => {
                const Icon = template.icon
                const isSelected = selected === template.id

                return (
                    <button
                        key={template.id}
                        type="button"
                        onClick={() => onSelect(template.id)}
                        className={cn(
                            "flex flex-col items-center justify-center text-center p-4",
                            "transition-all duration-150 outline-none",
                            "hover:bg-accent/60",
                            isSelected
                                ? "bg-primary/15"
                                : "bg-transparent"
                        )}
                    >
                        <div className={cn(
                            "p-3 rounded-xl mb-3 transition-colors",
                            isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}>
                            <Icon className="h-8 w-8" />
                        </div>
                        <p className={cn(
                            "font-semibold text-sm",
                            isSelected ? "text-primary" : "text-foreground"
                        )}>
                            {template.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                            {template.description}
                        </p>
                        <div className="flex items-center gap-1 mt-2">
                            {template.platforms.map(p => {
                                const PlatformIcon = PLATFORM_ICONS[p] || IconWorld
                                return <PlatformIcon key={p} className="h-3.5 w-3.5 text-muted-foreground" />
                            })}
                        </div>
                    </button>
                )
            })}

            {/* Empty filler tiles to complete the 4x2 grid (8 slots) */}
            {Array.from({ length: 8 - TEMPLATES.length }).map((_, i) => (
                <div key={`empty-${i}`} className="bg-transparent" />
            ))}
        </div>
    )
}
