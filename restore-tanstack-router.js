const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

// Restore tanstack router
file = file.replace(
  /const useNavigate = \(\) => \(\) => \{\}; const useSearch = \(\) => \(\{\};\)/g,
  'import { useNavigate, useSearch } from "@tanstack/react-router";'
);
file = file.replace(
  /import \{ useNavigate \} from "react-router-dom";\nconst useSearch = \(\) => \(\{\};/g,
  'import { useNavigate, useSearch } from "@tanstack/react-router";'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
