const { spawnSync } = require('child_process');
console.log('ENV:', Object.keys(process.env).join(', '));
