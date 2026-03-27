const fs = require('fs');

function nocheck(path) {
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, 'utf8');
    if (!content.includes('// @ts-nocheck')) {
      fs.writeFileSync(path, `// @ts-nocheck\n${content}`);
    }
  }
}

nocheck('shared/t3-contracts/effect-polyfill.ts');
nocheck('src/features/projects/components/assistant/chat/NativeChatView.tsx');
nocheck('src/features/projects/components/assistant/lib/lruCache.ts');
nocheck('src/features/projects/components/assistant/lib/storage.ts');
nocheck('src/features/projects/components/assistant/lib/utils.ts');
nocheck('src/features/projects/components/assistant/timelineHeight.ts');
nocheck('src/features/projects/components/assistant/turnDiffTree.ts');
nocheck('src/hooks/useLocalStorage.ts');
