const fs = require('fs');
let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(
  'import { useNavigate, useSearch } from "@tanstack/react-router";',
  'import { useNavigate } from "react-router-dom";\nconst useSearch = () => ({});'
);

file = file.replace(
  /from "\~\/lib\/gitReactQuery"/g,
  'from "../lib/gitReactQuery"'
);
file = file.replace(
  /from "\~\/lib\/projectReactQuery"/g,
  'from "../lib/projectReactQuery"'
);
file = file.replace(
  /from "\~\/lib\/serverReactQuery"/g,
  'from "../lib/serverReactQuery"'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
