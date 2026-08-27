import { useTheme } from '@/contexts/ThemeContext'
import logoDarkMode from '@/assets/logos/logo_dark_mode.png'
import logoLightMode from '@/assets/logos/logo_light_mode.png'

interface LogoProps {
  className?: string
  size?: number
}

// Light themes use the dark logo, dark themes use the light logo
const LIGHT_THEMES = ['light']

export function Logo({ className = '', size = 24 }: LogoProps) {
  const { theme } = useTheme()

  // Determine effective theme (handle 'system' by checking actual class)
  const getEffectiveTheme = () => {
    if (theme === 'system') {
      return document.documentElement.classList.contains('light') ? 'light' : 'dark'
    }
    return theme
  }

  const effectiveTheme = getEffectiveTheme()
  const isLightTheme = LIGHT_THEMES.includes(effectiveTheme)

  // Use dark logo on light backgrounds, light logo on dark backgrounds
  const logoSrc = isLightTheme
    ? logoLightMode
    : logoDarkMode

  return (
    <img
      src={logoSrc}
      alt="Cozea"
      width={size}
      height={size}
      className={className}
    />
  )
}
