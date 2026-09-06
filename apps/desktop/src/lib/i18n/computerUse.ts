export const computerUseTranslations = {
  en: {
    'settings.computerUse.advancedTitle': 'Advanced interaction',
    'settings.computerUse.advancedDescription':
      "Background and accessibility-targeted actions remain preferred. Physical pointer fallback is only used when an agent explicitly requests Open Computer Use's global click method.",
    'settings.computerUse.allowGlobalPointerFallback': 'Allow physical pointer fallback',
    'settings.computerUse.allowGlobalPointerFallbackDescription':
      'Permit the upstream global pointer path to move and click the system cursor when targeted interaction is not appropriate. Off by default.',
  },
  es: {
    'settings.computerUse.advancedTitle': 'Interacción avanzada',
    'settings.computerUse.advancedDescription':
      'Se prefieren las acciones en segundo plano y dirigidas mediante accesibilidad. El control físico del puntero solo se usa cuando un agente solicita explícitamente el método de clic global de Open Computer Use.',
    'settings.computerUse.allowGlobalPointerFallback': 'Permitir control físico del puntero',
    'settings.computerUse.allowGlobalPointerFallbackDescription':
      'Permite que la ruta global del puntero mueva y haga clic con el cursor del sistema cuando la interacción dirigida no sea apropiada. Desactivado de forma predeterminada.',
  },
} as const

export type ComputerUseTranslationKey = keyof typeof computerUseTranslations.en
