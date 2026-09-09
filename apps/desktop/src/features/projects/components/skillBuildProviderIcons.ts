import { ClaudeAI, CursorIcon, OpenAI, OpenCodeIcon, type Icon } from "@/features/assistant/Icons";
import type { AgentSkillProvider } from "@shared/electronApiTypes";

export const BUILD_PROVIDER_ICONS: Record<AgentSkillProvider, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
  cursor: CursorIcon,
  opencode: OpenCodeIcon,
};
