"use client"

import { useNavigate, useParams, useLocation } from "react-router-dom"
import {
    Settings,
    Users,
    GitBranch,
    Bell,
    Shield,
    AlertTriangle,
} from "lucide-react"
import { cn } from "@/lib/utils"

const settingsSections = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'access', label: 'Access', icon: Users },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle, danger: true },
]

export function SettingsSectionsList() {
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()
    const location = useLocation()

    // Extract current section from URL (e.g., /projects/my-project/settings/general)
    const pathParts = location.pathname.split('/')
    const settingsIndex = pathParts.indexOf('settings')
    const currentSection = settingsIndex !== -1 && pathParts[settingsIndex + 1]
        ? pathParts[settingsIndex + 1]
        : 'general'

    const handleSectionClick = (sectionId: string) => {
        if (slug) {
            navigate(`/projects/${slug}/settings/${sectionId}`)
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto py-1 space-y-1">
                {settingsSections.map((section) => {
                    const isActive = currentSection === section.id
                    return (
                        <div
                            key={section.id}
                            onClick={() => handleSectionClick(section.id)}
                            className={cn(
                                "flex items-center gap-2 mx-2 px-2 h-8 text-left cursor-pointer rounded-md",
                                "hover:bg-sidebar-accent transition-colors text-sm",
                                isActive && "bg-sidebar-accent",
                                section.danger && "text-red-500 hover:text-red-600"
                            )}
                        >
                            <section.icon className={cn(
                                "h-4 w-4 text-muted-foreground shrink-0",
                                section.danger && "text-red-500"
                            )} />
                            <span className="truncate">
                                {section.label}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
