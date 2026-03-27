const fs = require('fs');
let file = fs.readFileSync('convex/schema.ts', 'utf8');

const regex = /\n  \/\/ ============================================\n  \/\/ AI CONVERSATION HISTORY\n  \/\/ ============================================\n\n[\s\S]*?\.index\("by_expires_at", \["expiresAt"\]\),\n/m;
file = file.replace(regex, "");

fs.writeFileSync('convex/schema.ts', file);
