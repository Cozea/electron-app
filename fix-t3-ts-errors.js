const fs = require('fs');

function replaceFile(path, replacer) {
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, 'utf8');
    content = replacer(content);
    fs.writeFileSync(path, content);
  }
}

replaceFile('shared/t3-contracts/baseSchemas.ts', c => {
  return c.replace(/TrimmedString\.check\(Schema\.isNonEmpty\(\)\)/g, 'TrimmedString.pipe(Schema.nonEmptyString())');
});

replaceFile('shared/t3-contracts/editor.ts', c => {
  return c.replace(/Schema\.Literal\(EDITORS\.map\(\(e\) => e\.id\)\)/g, 'Schema.Literal(...(EDITORS.map((e) => e.id) as any))');
});

replaceFile('shared/t3-contracts/git.ts', c => {
  // Overload matches this call...
  c = c.replace(/Schema\.Literal\(GIT_STACKED_ACTIONS\)/g, 'Schema.Literal(...(GIT_STACKED_ACTIONS as any))');
  c = c.replace(/Schema\.Literal\(GIT_ACTION_PROGRESS_PHASES\)/g, 'Schema.Literal(...(GIT_ACTION_PROGRESS_PHASES as any))');
  c = c.replace(/Schema\.Literal\(GIT_ACTION_PROGRESS_KINDS\)/g, 'Schema.Literal(...(GIT_ACTION_PROGRESS_KINDS as any))');
  c = c.replace(/Schema\.Literal\(GIT_ACTION_PROGRESS_STREAMS\)/g, 'Schema.Literal(...(GIT_ACTION_PROGRESS_STREAMS as any))');
  c = c.replace(/Schema\.Literal\(GIT_COMMIT_STEP_STATUSES\)/g, 'Schema.Literal(...(GIT_COMMIT_STEP_STATUSES as any))');
  c = c.replace(/Schema\.Literal\(GIT_PUSH_STEP_STATUSES\)/g, 'Schema.Literal(...(GIT_PUSH_STEP_STATUSES as any))');
  c = c.replace(/Schema\.Literal\(GIT_BRANCH_STEP_STATUSES\)/g, 'Schema.Literal(...(GIT_BRANCH_STEP_STATUSES as any))');
  c = c.replace(/Schema\.Literal\(GIT_PR_STEP_STATUSES\)/g, 'Schema.Literal(...(GIT_PR_STEP_STATUSES as any))');
  c = c.replace(/Schema\.Literal\(GIT_STATUS_PR_STATES\)/g, 'Schema.Literal(...(GIT_STATUS_PR_STATES as any))');
  c = c.replace(/Schema\.Literal\(GIT_PULL_REQUEST_STATES\)/g, 'Schema.Literal(...(GIT_PULL_REQUEST_STATES as any))');
  c = c.replace(/Schema\.Literal\(GIT_PREPARE_PULL_REQUEST_THREAD_MODES\)/g, 'Schema.Literal(...(GIT_PREPARE_PULL_REQUEST_THREAD_MODES as any))');
  return c;
});

replaceFile('shared/t3-contracts/keybindings.ts', c => {
  c = c.replace(/typeof NonEmptyString\.check/g, 'Schema.decodeUnknownSync(NonEmptyString as any)');
  c = c.replace(/typeof Trim\.check/g, 'Schema.decodeUnknownSync(Trim as any)');
  c = c.replace(/Schema\.Array\(([^)]+)\)\.check/g, 'Schema.decodeUnknownSync(Schema.Array($1) as any)');
  return c;
});

replaceFile('shared/t3-contracts/orchestration.ts', c => {
  c = c.replace(/Schema\.optional\((.*?)\)/g, 'Schema.optional($1) as any');
  return c;
});

