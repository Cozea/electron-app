const fs = require('fs');

fs.rmSync('src/agents', { recursive: true, force: true });
fs.rmSync('src/components/ai', { recursive: true, force: true });
fs.rmSync('src/lib/ai', { recursive: true, force: true });

