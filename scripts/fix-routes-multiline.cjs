const fs = require('fs');

let content = fs.readFileSync('src/router/routes.tsx', 'utf8');

content = content.replace(/const MemberDetails[\s\S]*?\)\n/g, '');
content = content.replace(/const Policies[\s\S]*?\)\n/g, '');
content = content.replace(/const WORKSPACE_POLICIES_ROUTE.*?\n/g, '');
content = content.replace(/Outlet,/g, '');
fs.writeFileSync('src/router/routes.tsx', content);
