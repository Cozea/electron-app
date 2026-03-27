const fs = require('fs');
let file = fs.readFileSync('convex/organizations.ts', 'utf8');

file = file.replace(
  "function getUtcDayStartTimestamp(ts: number): number {\n  const date = new Date(ts)\n  date.setUTCHours(0, 0, 0, 0)\n  return date.getTime()\n}\n\nfunction getUtcMonthStartTimestamp(ts: number): number {\n  const date = new Date(ts)\n  date.setUTCDate(1)\n  date.setUTCHours(0, 0, 0, 0)\n  return date.getTime()\n}\n\n",
  ""
);

fs.writeFileSync('convex/organizations.ts', file);
