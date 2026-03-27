const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(
  'import { useSettings } from "~/components/settings/useSettings";',
  'const useSettings = () => ({ timestampFormat: "locale" });'
);
file = file.replace(
  'import { useSettings } from "../settings/useSettings";',
  'const useSettings = () => ({ timestampFormat: "locale" });'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
