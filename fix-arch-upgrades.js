const fs = require('fs');

let md = fs.readFileSync('ARCHITECTURAL_UPGRADES.md', 'utf8');

md = md.replace(
  /\* \*\*Action:\*\* Rip out our `\.eslintrc` and `prettier` configs and swap them for `oxlint`\./g,
  '* **Status:** ✅ Migrated successfully. The project now uses `oxlint` and `oxfmt`.'
);

fs.writeFileSync('ARCHITECTURAL_UPGRADES.md', md);
