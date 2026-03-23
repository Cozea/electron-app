const fs = require('fs');

let content = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');

content = content.replace(
  "      defaultBranch: repoSource.branch,",
  "      defaultBranch: state.sourceControl.defaultBranch || repoSource.branch,"
);

content = content.replace(
  "      workingCopyMode: repoSource.provider === 'local' ? 'attached' as const : 'managed' as const,",
  "      workingCopyMode: state.sourceControl.workingCopyMode || (repoSource.provider === 'local' ? 'attached' as const : 'managed' as const),"
);

content = content.replace(
  "          branch: repoSource.branch,",
  "          branch: state.sourceControl.defaultBranch || repoSource.branch,"
);

fs.writeFileSync('src/pages/NewProject.tsx', content);
