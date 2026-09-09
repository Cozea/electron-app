export const computerUseTranslations = {
  en: {
    'settings.computerUse.macosOnly': 'Computer Use is currently available on macOS only.',
    'settings.computerUse.advancedTitle': 'Advanced interaction',
    'settings.computerUse.advancedDescription':
      'Physical cursor control and fallback behavior.',
    'settings.computerUse.allowGlobalPointerFallback': 'Allow physical pointer fallback',
    'settings.computerUse.allowGlobalPointerFallbackDescription':
      'Permit the explicitly authorized global pointer path to move and click the system cursor when targeted interaction is not appropriate. Off by default.',
  },
  es: {
    'settings.computerUse.macosOnly': 'Computer Use está disponible actualmente solo en macOS.',
    'settings.computerUse.advancedTitle': 'Interacción avanzada',
    'settings.computerUse.advancedDescription':
      'Se prefieren las acciones en segundo plano y dirigidas mediante accesibilidad. El control físico del puntero solo se usa cuando un agente solicita explícitamente el método de clic global.',
    'settings.computerUse.allowGlobalPointerFallback': 'Permitir control físico del puntero',
    'settings.computerUse.allowGlobalPointerFallbackDescription':
      'Permite que la ruta global autorizada del puntero mueva y haga clic con el cursor del sistema cuando la interacción dirigida no sea apropiada. Desactivado de forma predeterminada.',
  },
} as const

export type ComputerUseTranslationKey = keyof typeof computerUseTranslations.en
