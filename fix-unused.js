const fs = require('fs');

function fix(file) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace("import React, {", "import {");
    content = content.replace("import React from 'react';\n", "");
    fs.writeFileSync(file, content);
  }
}

fix('src/features/projects/components/assistant/chat/ChatMarkdown.tsx');
fix('src/features/projects/components/assistant/chat/MessagesTimeline.tsx');
