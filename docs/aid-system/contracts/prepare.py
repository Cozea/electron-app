#!/usr/bin/env python3
"""Generate design-only fixtures and indexes from the preserved AID corpus.

No production source, native input, provider configuration or release is changed.
Run from any working directory. Python 3.10+; standard library only.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re
from pathlib import Path

C = Path(__file__).resolve().parent
D = C.parent
ROOT = D.parent.parent

def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + '\n', encoding='utf-8')

def put(name: str, value: object) -> None:
    write(C / name, json.dumps(value, ensure_ascii=False, indent=2))

names = [
 '01-baseline-decisions','02-contracts-sdk','03-javascript-workspaces','04-isolation-processes',
 '05-lifecycle-authority','06-continuations-checkpoints','07-evidence-scene','08-accessibility',
 '09-capture-artifacts','10-watches-servo','11-spatial-validity','12-motor-timelines',
 '13-keyboard-clipboard','14-cursor-presentation','15-apps-windows-backends','16-journal-recovery',
 '17-host-provider-protocol','18-human-supervision','19-security-privacy','20-evaluation',
 '21-procedural-memory','22-pipelined-planning','23-debugger-replay','24-demonstrations',
 '25-separate-seats','26-extended-devices','27-integration-packaging']
for name in names:
    p = D / (name + '.md')
    if not p.is_file() or len(p.read_bytes()) < 1000:
        raise SystemExit('Required preserved subsystem is absent or empty: ' + str(p))
for name in ['MASTER.md','28-implementation-roadmap.md','29-research-register.md','30-qualification-gates.md','31-cross-system-review.md']:
    if not (D / name).is_file():
        raise SystemExit('Required completed design is absent: ' + name)

# Freeze refinements discovered while comparing the typed and JSON contracts.
p = C / 'aid-sdk.d.ts'
s = p.read_text()
s = s.replace('export interface AppQuery {\n  readonly bundleId?: string;\n  readonly pid?: number;\n  readonly name?: string;\n}', 'export type AppQuery =\n  | { readonly bundleId: string; readonly pid?: never; readonly name?: never }\n  | { readonly pid: number; readonly bundleId?: never; readonly name?: never }\n  | { readonly name: string; readonly bundleId?: never; readonly pid?: never };')
if 'readonly verification?:' not in s:
    needle = '  readonly outcome: Outcome;\n'
    if s.count(needle) != 1:
        raise SystemExit('Receipt refinement anchor changed; review manually.')
    s = s.replace(needle, needle + '  readonly verification?: { readonly predicateId: string; readonly method: "host-predicate" | "model-adjudication" | "human-adjudication"; readonly evidenceIds: readonly ObservationId[] };\n')
write(p, s)

# Exact schema vocabulary must follow the declaration, not a looser copy.
schema = json.loads((C / 'aid-wire.schema.json').read_text())
match = re.search(r'export type ErrorCode = (.*?);', s)
if not match:
    raise SystemExit('ErrorCode declaration is missing.')
error_codes = re.findall(r'"([A-Z_]+)"', match.group(1))
schema['$defs']['executionSnapshot']['properties']['error']['properties']['code'] = {'enum': error_codes}
put('aid-wire.schema.json', schema)

# Explicit anchor aliases preserve links from the earlier design without relying
# on a renderer's punctuation/heading-slug behavior.
for filename, pattern in [('28-implementation-roadmap.md', r'^(### (W\d\d) — .+)$'), ('30-qualification-gates.md', r'^(## \d+\. Gate (G\d\d) — .+)$')]:
    p = D / filename
    text = p.read_text()
    for m in list(re.finditer(pattern, text, re.M))[::-1]:
        anchor = '<a id="' + m.group(2).lower() + '"></a>'
        if anchor not in text:
            text = text[:m.start()] + anchor + '\n' + text[m.start():]
    write(p, text)

work = [
 ('W01',[],[1,20]), ('W02',['W01'],[2,31]), ('W03',['W02'],[2]),
 ('W04',['W02'],[4,27]), ('W05',['W02'],[3,4]), ('W06',['W03'],[5,19]),
 ('W07',['W04','W06'],[5,12,18]), ('W08',['W03','W06'],[16]),
 ('W09',['W04','W06'],[15]), ('W10',['W04','W07','W09'],[14]),
 ('W11',['W07','W08','W09','W10'],[12,15]), ('W12',['W07','W08','W09'],[13]),
 ('W13',['W10','W11','W12'],[12]), ('W14',['W04','W06','W09'],[9]),
 ('W15',['W03','W06','W08','W14'],[9,19]), ('W16',['W04','W06','W09'],[8]),
 ('W17',['W14','W15','W16'],[7]), ('W18',['W07','W09','W16','W17'],[11]),
 ('W19',['W13','W17','W18'],[11]), ('W20',['W16','W17','W18','W19'],[10]),
 ('W21',['W03','W05','W06'],[3]), ('W22',['W03','W15','W16','W18','W19','W20','W21'],[2,3]),
 ('W23',['W08','W21','W22'],[16]), ('W24',['W15','W18','W23'],[6]),
 ('W25',['W03','W06','W23','W24'],[17,27]), ('W26',['W25'],[17]),
 ('W27',['W07','W15','W23','W24','W25'],[18]), ('W28',['W04','W06','W08','W15','W24','W27'],[19]),
 ('W29',['W13','W19','W22','W24','W27','W28','W32'],[20]), ('W30',['W29'],[20]),
 ('W31',['W29','W30'],[1,20]), ('W32',['W04','W05','W22','W25','W27'],[27]),
 ('W33',['W31','W32'],[20]), ('W34',['W26','W28','W33'],[20,27]), ('W35',['W34'],[27]),
 ('X01',['W35'],[21]), ('X02',['W35'],[22]), ('X03',['W35'],[23]), ('X04',['W35'],[24]),
 ('X05',['W35'],[25]), ('X06',['W35'],[26])]
# W29 requires the packaged bundle. Numeric work IDs are not a strict serial order.
p = D / '28-implementation-roadmap.md'
s = p.read_text().replace('**Dependencies:** W13, W19, W22, W24, W27, W28.\n', '**Dependencies:** W13, W19, W22, W24, W27, W28, W32.\n')
write(p, s)
file_by_doc = {int(p.name[:2]): p.name for p in D.glob('[0-9][0-9]-*.md')}
work_rows = []
for wid, deps, docs in work:
    work_rows.append({'id': wid, 'dependsOn': deps, 'documents': [file_by_doc[x] for x in docs], 'state':'not-started', 'specification':'28-implementation-roadmap.md'})
put('work-packages.json', {'revision':'1.1','packages':work_rows})

gate_titles = {
 'G01':'Signed topology, IPC and permission attribution', 'G02':'Resident JavaScript semantics and isolation',
 'G03':'T3/provider/protocol/image/checkpoint delivery', 'G04':'Authority, liveness, input ownership and native stop',
 'G05':'Devices, timelines and truthful cursor', 'G06':'Semantic and spatial dependency validity',
 'G07':'Capture ownership, freshness and artifact races', 'G08':'Security, privacy and human approval',
 'G09':'Verified task outcomes and measured infrastructure overhead', 'G10':'Optional memory/debug/demonstration/planning',
 'G11':'Independent seats', 'G12':'Extended devices'}
put('qualification-status.json', {'revision':'1.1','profile':'macOS26-apple-silicon-initial','runtimeImplemented':False,'gates':[{'id':k,'title':v,'status':'not-run','evidence':[]} for k,v in gate_titles.items()]})

# Route metadata is explicit; guest combinators still authorize every nested leaf.
methods = [
 ('apps.list','host','evidence-read',['apps.read']), ('apps.get','host','evidence-read',['apps.read']), ('apps.prepare','driver','window-mutation',['apps.prepare','windows.control']),
 ('apps.activate','driver','window-mutation',['windows.control']), ('apps.windows','driver','evidence-read',['windows.read']), ('apps.mainWindow','driver','evidence-read',['windows.read']),
 ('windows.list','driver','evidence-read',['windows.read']), ('windows.get','driver','evidence-read',['windows.read']), ('windows.focus','driver','window-mutation',['windows.control']), ('windows.setBounds','driver','window-mutation',['windows.control']),
 ('windows.query','driver','evidence-read',['accessibility.read']), ('windows.observe','driver','evidence-read',['windows.read']), ('observe.window','sdk-alias','evidence-read',['windows.read']),
 ('elements.refresh','driver','evidence-read',['accessibility.read']), ('elements.perform','driver','semantic-input',['accessibility.act']), ('elements.setValue','driver','semantic-input',['accessibility.act']),
 ('observations.query','guest','pure',[]), ('observations.point','guest','pure',[]), ('observations.bindSurface','driver','evidence-read',['windows.read']), ('observations.release','host','supervisor',[]),
 ('surfaces.point','guest','pure',[]), ('surfaces.validate','driver','evidence-read',['windows.read']), ('surfaces.observe','driver','evidence-read',['windows.read']), ('surfaces.release','driver','supervisor',[]),
 ('pointer.moveTo','driver','physical-input',['pointer.control']), ('pointer.moveBy','driver','physical-input',['pointer.control']), ('pointer.hover','driver','physical-input',['pointer.control']), ('pointer.click','driver','physical-input',['pointer.control']),
 ('pointer.buttonDown','driver','physical-input',['pointer.control']), ('pointer.buttonUp','driver','physical-input',['pointer.control']), ('pointer.withButtonDown','guest-combinator','physical-input',['pointer.control']),
 ('pointer.followPath','driver','physical-input',['pointer.control']), ('pointer.scroll','driver','physical-input',['pointer.control']), ('pointer.play','driver','physical-input',['pointer.control']),
 ('surface.pointer.stroke','driver','physical-input',['pointer.control']), ('surface.pointer.moveTo','sdk-alias','physical-input',['pointer.control']), ('surface.pointer.click','sdk-alias','physical-input',['pointer.control']),
 ('keyboard.typeText','driver','physical-input',['keyboard.control']), ('keyboard.chord','driver','physical-input',['keyboard.control']), ('keyboard.keyDown','driver','physical-input',['keyboard.control']), ('keyboard.keyUp','driver','physical-input',['keyboard.control']), ('keyboard.withKeysDown','guest-combinator','physical-input',['keyboard.control']),
 ('events.until','guest-combinator','evidence-read',[]), ('events.watchQuery','host','evidence-read',['accessibility.read']), ('events.wait','host','pure',[]), ('watch.next','host','evidence-read',[]), ('watch.close','host','supervisor',[]),
 ('clipboard.readText','driver','clipboard-read',['clipboard.read']), ('clipboard.writeText','driver','clipboard-write',['clipboard.write']), ('clipboard.pasteText','host','clipboard-write',['clipboard.write','keyboard.control']),
 ('artifact.read','host','evidence-read',['artifacts.read']), ('artifact.release','host','supervisor',[]), ('execution.emit','host','artifact-export',['artifacts.export']), ('execution.decide','host','supervisor',[]), ('execution.inspectReceipts','host','evidence-read',[]),
 ('workspace.modules','host','pure',[]), ('workspace.saveData','host','pure',[]), ('workspace.loadData','host','pure',[]), ('describe','host','evidence-read',[])]
put('method-catalogue.json', {'revision':'1.1','note':'Minimum capability metadata. Actual route, requested image/text export and all nested effects impose additional per-call checks. No dynamic native symbol invocation is allowed.','methods':[{'name':n,'layer':l,'effectClass':e,'minimumCapabilities':c,'ownerChecked':l!='guest','cancelScope':'execution','contract':'aid-sdk.d.ts'} for n,l,e,c in methods]})

def request(method: str, args: dict) -> dict:
    return {'apiVersion':'1.0','requestId':'req_1','method':method,'arguments':args}
valid = [
 ('open-pure',request('open',{'idempotencyKey':'open_1','workspaceName':'draft'})),
 ('open-control',request('open',{'idempotencyKey':'open_2','workspaceName':'draft','control':{'mode':'visible-ui','capabilities':['apps.read','apps.prepare','windows.control','capture.read','artifacts.export'],'apps':[{'bundleId':'com.apple.Safari'}]}})),
 ('exec-inline',request('exec',{'workspaceId':'ws_1','controlId':'ctl_1','idempotencyKey':'exec_1','cellName':'navigate','source':{'kind':'inline','text':'export const answer = 42;'}})),
 ('exec-artifact',request('exec',{'workspaceId':'ws_1','idempotencyKey':'exec_2','cellName':'geometry','source':{'kind':'artifact','artifactId':'art_1','sha256':'a'*64}})),
 ('inspect-execution',request('inspect',{'executionId':'exec_1','sinceSequence':'7'})),
 ('inspect-workspace',request('inspect',{'workspaceId':'ws_1'})),
 ('respond-model',request('respond',{'executionId':'exec_1','checkpointId':'cp_1','idempotencyKey':'answer_1','response':'choice_2'})),
 ('close-execution',request('close',{'executionId':'exec_1'})),
 ('close-control',request('close',{'controlId':'ctl_1'})),
 ('close-workspace',request('close',{'workspaceId':'ws_1'})),
 ('describe',request('describe',{'module':'pointer'}))]
receipt={'operationId':'op_1','executionId':'exec_1','route':'foreground-event','submission':'submitted','evidence':'not_checked','outcome':'unverified','after':{'operationId':'op_1','sequence':'1'},'evidenceIds':[],'canRetryAutomatically':False,'timingsMs':{'dispatch':2.0},'warnings':[]}
valid.append(('submitted-is-not-verified',receipt))
verified=copy.deepcopy(receipt);verified.update(evidence='change_observed',outcome='verified',evidenceIds=['obs_1'],verification={'predicateId':'count-incremented','method':'host-predicate','evidenceIds':['obs_1']})
valid.append(('verified-with-predicate',verified))
waiting={'executionId':'exec_1','workspaceId':'ws_1','state':'waiting-for-model','sequence':'2','checkpoint':{'id':'cp_1','kind':'model-decision','executionId':'exec_1','responseSchema':{'type':'string','enum':['a','b']},'expiresAt':'2026-09-08T23:00:00Z','question':'Choose the observed target.','evidenceIds':['obs_1']},'receiptIds':['op_1'],'artifactIds':[],'historyComplete':True,'quiescent':True}
valid.append(('waiting-model-quiescent',waiting))
complete={k:v for k,v in waiting.items() if k!='checkpoint'};complete['state']='completed';valid.append(('complete-quiescent',complete))
invalid=[]
def bad(name: str, value: dict, edit) -> None:
    obj=copy.deepcopy(value);edit(obj);invalid.append((name,obj))
bad('forged-principal',valid[2][1],lambda x:x.update(principalId='attacker'))
bad('forged-arguments-owner',valid[2][1],lambda x:x['arguments'].update(owner='attacker'))
bad('missing-source',valid[2][1],lambda x:x['arguments'].pop('source'))
bad('unknown-method',valid[2][1],lambda x:x.update(method='runShell'))
bad('two-close-targets',valid[7][1],lambda x:x['arguments'].update(controlId='ctl_1'))
bad('empty-close',valid[7][1],lambda x:x.update(arguments={}))
bad('partial-app-query',valid[1][1],lambda x:x['arguments']['control'].update(apps=[{}]))
bad('mixed-app-query',valid[1][1],lambda x:x['arguments']['control'].update(apps=[{'pid':42,'name':'Safari'}]))
bad('silent-hybrid',valid[1][1],lambda x:x['arguments']['control'].update(capabilities=['hybrid.execute']))
bad('numeric-counter',valid[4][1],lambda x:x['arguments'].update(sinceSequence=7))
bad('negative-counter',valid[4][1],lambda x:x['arguments'].update(sinceSequence='-1'))
bad('human-role-from-model',valid[6][1],lambda x:x['arguments'].update(approvedBy='human'))
bad('retry-submitted',receipt,lambda x:x.update(canRetryAutomatically=True))
bad('verification-without-evidence',receipt,lambda x:x.update(outcome='verified'))
bad('missing-checkpoint',waiting,lambda x:x.pop('checkpoint'))
bad('wrong-checkpoint-kind',waiting,lambda x:x['checkpoint'].update(kind='human-approval'))
bad('held-input-at-checkpoint',waiting,lambda x:x.update(quiescent=False))
bad('complete-not-quiescent',complete,lambda x:x.update(quiescent=False))
bad('complete-pending-checkpoint',complete,lambda x:x.update(checkpoint=copy.deepcopy(waiting['checkpoint'])))
bad('bad-source-hash',valid[3][1],lambda x:x['arguments']['source'].update(sha256='oops'))
put('wire-vectors.json', {'revision':'1.1','valid':[{'name':n,'value':x} for n,x in valid],'invalid':[{'name':n,'value':x} for n,x in invalid]})

states=['queued','running','waiting-for-condition','waiting-for-model','waiting-for-user','paused','cancelling','completed','failed','cancelled','interrupted-after-possible-effect']
transitions={
 'queued':['running','cancelling','failed'],
 'running':['waiting-for-condition','waiting-for-model','waiting-for-user','paused','cancelling','completed','failed','interrupted-after-possible-effect'],
 'waiting-for-condition':['running','cancelling','failed'],
 'waiting-for-model':['running','cancelling','failed','interrupted-after-possible-effect'],
 'waiting-for-user':['running','cancelling','failed','interrupted-after-possible-effect'],
 'paused':['running','cancelling','failed'],
 'cancelling':['cancelled','interrupted-after-possible-effect'],
 'completed':[],'failed':[],'cancelled':[],'interrupted-after-possible-effect':[]}
put('state-model-vectors.json', {'revision':'1.1','states':states,'transitions':transitions,'terminal':['completed','failed','cancelled','interrupted-after-possible-effect'],'scenarios':['duplicate-effect-request','conflicting-effect-request','duplicate-model-answer','model-answer-to-human-checkpoint','window-moved-while-waiting','worker-lost-with-continuation','last-capture-owner-with-borrower','late-capture-generation','capture-gap-with-owner','revoke-between-down-and-up','unrelated-status-change','semantic-label-change','expected-ink-change','canvas-zoom-change','unsafe-counter','duplicate-json-key']})

gates_by_doc={1:['G09'],2:['G02','G03','G08'],3:['G02'],4:['G01','G02'],5:['G04'],6:['G02','G03','G04'],7:['G06','G07'],8:['G06'],9:['G07'],10:['G06'],11:['G06'],12:['G04','G05'],13:['G05','G08'],14:['G05'],15:['G05','G06'],16:['G04','G08'],17:['G03'],18:['G04','G08'],19:['G08'],20:['G09'],21:['G10'],22:['G10'],23:['G10'],24:['G10'],25:['G11'],26:['G12'],27:['G01','G03']}
requirements={}
for i,name in enumerate(names,1):
    text=(D/(name+'.md')).read_text()
    for rid in re.findall(r'\b[A-Z][A-Z0-9]{1,14}-\d{2,3}\b',text):
        rec=requirements.setdefault(rid,{'id':rid,'documents':[],'workPackages':[],'gates':[],'implementationStatus':'not-run'})
        if name+'.md' not in rec['documents']:rec['documents'].append(name+'.md')
        rec['workPackages']=sorted(set(rec['workPackages']+[w for w,_,ds in work if i in ds]))
        rec['gates']=sorted(set(rec['gates']+gates_by_doc[i]))
for i in range(1,15):
    rid=f'INV-{i:02}'
    requirements.setdefault(rid,{'id':rid,'documents':['MASTER.md','31-cross-system-review.md'],'workPackages':['W02','W28','W34'],'gates':['G04','G05','G06','G08','G09'],'implementationStatus':'not-run'})
put('traceability.json', {'revision':'1.1','requirements':sorted(requirements.values(),key=lambda r:r['id']),'coverageMeaning':'Design ownership and required future evidence; not a claim these implementation tests have run.'})

write(C/'examples/geometry.mjs','''// @ts-check
/** Pure named cell `geometry`; no desktop effects at module initialization. */
/** @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} [segments]
 * @returns {Array<readonly [number, number]>} */
export function ellipse(cx, cy, rx, ry, segments = 80) {
  if (![cx,cy,rx,ry].every(Number.isFinite) || !Number.isInteger(segments) || segments < 4 || segments > 10000) throw new RangeError('Invalid geometry');
  return Array.from({length: segments + 1}, (_, i) => {
    const a = 2 * Math.PI * i / segments;
    /** @type {readonly [number, number]} */
    const point = [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
    return point;
  });
}
''')
write(C/'examples/navigation.mjs','''// @ts-check
// Illustrative cell. Requires the future qualified runtime and actual permission.
import { aid } from 'aid:runtime';
const safari = await aid.apps.prepare({app:{bundleId:'com.apple.Safari'},launch:true,foreground:true});
await safari.keyboard.chord('super+t');
await safari.keyboard.typeText('https://example.com/');
await safari.keyboard.chord('Return');
const view = await safari.mainWindow();
export const observation = await view.observe({accessibility:true,image:'overview'});
await aid.execution.emit({kind:'observation',observation});
''')
write(C/'examples/drawing.mjs','''// @ts-check
// This uses an observed test canvas; it is not evidence of successful Notes drawing.
import { aid } from 'aid:runtime';
import { ellipse } from 'workspace:/geometry';
const app = await aid.apps.prepare({app:{name:'Cozea AID Fixture'},foreground:true});
const view = await app.mainWindow();
const observation = await view.observe({accessibility:true,image:'overview'});
const canvas = observation.query({roles:['AXGroup'],name:'Canvas'}).one();
if (!canvas.observed.frame) throw new Error('Observed canvas geometry is required');
export const surface = await observation.bindSurface({region:canvas.observed.frame,anchors:[canvas.id],intent:'drawing',requiredCoverage:'qualified'});
for (let i = 0; i < 20; i++) {
  await surface.pointer.stroke(ellipse(0.5,0.5,0.2+i*0.004,0.25),{durationMs:450,interpolation:'polyline',approach:'fast-visible'});
}
await aid.execution.emit({kind:'observation',observation:await surface.observe({image:'overview'})});
''')
write(C/'examples/checkpoint.mjs','''// @ts-check
import { aid } from 'aid:runtime';
const app = await aid.apps.prepare({app:{name:'Cozea AID Fixture'},foreground:true});
const view = await app.mainWindow();
const observation = await view.observe({accessibility:true,image:'overview'});
const candidates = observation.query({roles:['AXButton']});
if (candidates.items.length === 0) throw new Error('No observed choices');
const choice = await aid.execution.decide({question:'Choose the observed control matching the task.',observation,choices:candidates.items.map(e=>({id:e.id,label:e.observed.label})),responseSchema:{type:'string',enum:candidates.items.map(e=>e.id)}});
const selected = candidates.items.find(e=>e.id===choice);
if (!selected) throw new Error('Checkpoint answer was not an observed choice');
// Native dependency validation still runs here after the judgment delay.
await aid.pointer.click(selected);
''')
write(C/'examples/negative.ts','''import { aid, type ExecRequest, type WorkspaceId } from 'aid:runtime';
// @ts-expect-error A raw numeric pair is not a framed desktop point.
void aid.pointer.moveTo([10, 20]);
// @ts-expect-error A keyboard chord is not a number.
void aid.keyboard.chord(23);
// @ts-expect-error Explicit preparation requires an application query.
void aid.apps.prepare({foreground:true});
// @ts-expect-error App query selects one identity, not mixed PID/name.
void aid.apps.get({pid:42,name:'Safari'});
// @ts-expect-error Decisions require a typed response schema.
void aid.execution.decide({question:'Choose'});
// @ts-expect-error Timeline backpressure/timing policy is required.
void aid.pointer.play({events:[],durationMs:10});
declare const ws: WorkspaceId;
function accept(_value: ExecRequest): void {}
// @ts-expect-error The model cannot supply an authenticated principal.
accept({workspaceId:ws,idempotencyKey:'key',cellName:'cell',source:{kind:'inline',text:''},principal:'forged'});
''')
put('tsconfig.json', {'compilerOptions':{'target':'ES2022','module':'ESNext','moduleResolution':'Bundler','strict':True,'noEmit':True,'allowJs':True,'checkJs':True,'skipLibCheck':False,'types':[],'lib':['ES2022'],'baseUrl':'.','paths':{'aid:runtime':['aid-sdk.d.ts'],'workspace:/geometry':['examples/geometry.mjs']}},'include':['aid-sdk.d.ts','examples/*.mjs','examples/*.ts']})

# Entry-point addendum supersedes incidental older package-number references.
master=D/'MASTER.md';text=master.read_text();marker='## Design handoff revision 1.1'
if marker not in text:
    text+='\n\n'+marker+'\n\nThe completed design entry set is D01–D31 plus the contract artifacts. Read [D31](31-cross-system-review.md) for resolved cross-subsystem semantics, [D28](28-implementation-roadmap.md) for the authoritative W01–W35/X01–X06 dependency order, [D29](29-research-register.md) for primary-source limitations, and [D30](30-qualification-gates.md) for exact gates. Incidental work-package numbers in earlier prose do not override D28. Newer protocol/engine/platform opportunities are not assumed deployed in the current app.\n\nThe declarations, schema, example cells, work graph and state-model checks are documentation-stage implementation inputs. Platform gates start at `not-run`. A design validation report must distinguish mechanical checks, source retrieval and platform qualification. No runtime code or release is supplied by this handoff.\n'
write(master,text)
index=['# Cozea AID design handoff index','','Start with [MASTER](MASTER.md), then [D31](31-cross-system-review.md), [D28](28-implementation-roadmap.md), [D02](02-contracts-sdk.md) and [D05](05-lifecycle-authority.md).','','## Subsystem specifications','']
for p in sorted(D.glob('[0-9][0-9]-*.md')):
    title=p.read_text().splitlines()[0].lstrip('# ')
    index.append(f'- [{title}]({p.name})')
index+=['','## Contract and audit material','','- [Contract artifacts](contracts/README.md)','- [Typed SDK](contracts/aid-sdk.d.ts)','- [Wire schema](contracts/aid-wire.schema.json)','- [Work graph](contracts/work-packages.json)','- [Traceability](contracts/traceability.json)','- [Unrun qualification status](contracts/qualification-status.json)','','The earlier recovered corpus is retained. Newly completed roadmap/research/gate/contracts are not described as byte-for-byte recovery of missing old files.']
write(D/'README.md','\n'.join(index))
put('preparation-record.json',{'revision':'1.1','scope':'documentation-only','preservedSubsystemCount':27,'completedSubsystemCount':31,'workPackageCount':len(work),'runtimeTestsRun':False,'sourceResearchMeaning':'Primary documentation and adoption limits are in D29. HTTP availability is not semantic or platform qualification.'})
print(json.dumps({'prepared':True,'workPackages':len(work),'requirements':len(requirements),'wireValid':len(valid),'wireInvalid':len(invalid),'methods':len(methods)},sort_keys=True))
