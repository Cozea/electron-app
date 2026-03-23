const fs = require('fs');

let newProject = fs.readFileSync('src/pages/NewProject.tsx', 'utf8');
newProject = newProject.replace(
  "        preserveInsetInFullHeight={\n          state.path === 'repo' &&\n          (currentStepDef?.id === 'review' || currentStepDef?.id === 'repo-source')\n        }",
  "        preserveInsetInFullHeight={\n          state.path === 'repo' &&\n          (currentStepDef?.id === 'repo-source')\n        }"
);
fs.writeFileSync('src/pages/NewProject.tsx', newProject);

let reviewStep = fs.readFileSync('src/components/wizard/steps/ReviewStep.tsx', 'utf8');
reviewStep = reviewStep.replace(
  "          <div className=\"flex-1 overflow-y-auto app-scrollbar flex flex-col\">\n            {repoReviewBody}\n          </div>",
  "          <div className=\"flex-1 overflow-y-auto app-scrollbar\">\n            {repoReviewBody}\n          </div>"
);
fs.writeFileSync('src/components/wizard/steps/ReviewStep.tsx', reviewStep);
