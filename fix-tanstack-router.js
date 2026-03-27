const fs = require('fs');

let file = fs.readFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', 'utf8');

file = file.replace(
  'import { useNavigate, useSearch } from "@tanstack/react-router";',
  'const useNavigate = () => () => {}; const useSearch = () => ({});'
);

fs.writeFileSync('src/features/projects/components/assistant/chat/ChatView.tsx', file);
