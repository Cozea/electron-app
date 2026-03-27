const fs = require('fs');
let file = fs.readFileSync('server/src/lib/convex.ts', 'utf8');

const regex = /\): Promise<UsageLogResult> \{[\s\S]*?\}\n\n\n\n\): Promise<\{ ok: boolean; runId: string; step: number \}> \{[\s\S]*?throw new Error\('AI_GATEWAY_SECRET environment variable is required'\)[\s\S]*?return result as \{ ok: boolean; runId: string; step: number \}[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ ok: false, runId: params\.runId, step: params\.step \}[\s\S]*?\}\n\n\}\n\n\n\n\): Promise<AgentRunForServer \| null> \{[\s\S]*?\} catch \(err\) \{[\s\S]*?return null[\s\S]*?\}\n\n\}\n\n\n\n\): Promise<RepoSessionForServer \| null> \{[\s\S]*?return null[\s\S]*?\}\n\n\}/m;

file = file.replace(regex, "");

fs.writeFileSync('server/src/lib/convex.ts', file);
