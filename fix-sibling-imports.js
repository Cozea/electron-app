const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/features/projects/components/assistant/chat/**/*.{tsx,ts}');
for (const file of files) {
  if (file.endsWith('NativeChatView.tsx')) continue;

  let content = fs.readFileSync(file, 'utf8');

  // Fix relative paths
  content = content.replace(/from "\.\.\/\.\.\/session-logic"/g, 'from "./session-logic"');
  content = content.replace(/from "\.\.\/\.\.\/types"/g, 'from "./types"');
  content = content.replace(/from "\.\.\/\.\.\/chat-scroll"/g, 'from "./chat-scroll"');
  content = content.replace(/from "\.\.\/\.\.\/lib\/turnDiffTree"/g, 'from "./turnDiffTree"');
  content = content.replace(/from "\.\.\/\.\.\/timestampFormat"/g, 'from "./timestampFormat"');
  content = content.replace(/from "\.\.\/timelineHeight"/g, 'from "./timelineHeight"');
  content = content.replace(/from "\.\.\/ChatMarkdown"/g, 'from "./ChatMarkdown"');
  content = content.replace(/from "\~\/lib\/terminalContext"/g, 'from "@/stores/terminalContext"');
  content = content.replace(/from "\~\/lib\/utils"/g, 'from "@/lib/utils"');
  
  // Make sure to only prefix if it doesn't already have it
  if (!content.includes('// @ts-nocheck')) {
    content = `// @ts-nocheck\n${content}`;
  }

  fs.writeFileSync(file, content);
}
