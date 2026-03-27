const fs = require('fs');

let pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.scripts.lint = "oxlint";
pkg.scripts.fmt = "oxfmt -w .";
pkg.scripts["fmt:check"] = "oxfmt --check .";

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
