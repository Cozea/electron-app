const fs = require('fs');

let content = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');

// Remove formatRelativeLastCommit completely as it's unused
content = content.replace(/function formatRelativeLastCommit\([\s\S]*?return `\$\{Math\.floor\(deltaMs \/ year\)\}y ago`\n\}\n\n/, '');

fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', content);
