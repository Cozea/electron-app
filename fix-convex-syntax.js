const fs = require('fs');
let file = fs.readFileSync('server/src/lib/convex.ts', 'utf8');

// Fix syncBuiltinTools
file = file.replace(
  "    return { created: 0, updated: 0 }\n\n}",
  "    return { created: 0, updated: 0 }\n  }\n}"
);

// Fix purgeLegacyTools
file = file.replace(
  "    return { removed: 0 }\n\n}",
  "    return { removed: 0 }\n  }\n}"
);

// Fix listEnabledTools
file = file.replace(
  "    console.error('Failed to list tools:', err)\n    return []\n  }\n\n\nexport type ContinuationProvider = string",
  "    console.error('Failed to list tools:', err)\n    return []\n  }\n}\n\nexport type ContinuationProvider = string"
);

fs.writeFileSync('server/src/lib/convex.ts', file);
