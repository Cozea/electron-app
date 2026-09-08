#!/usr/bin/env python3
"""Build/validate the documentation contract. Never controls a desktop.

--write updates only the explicit documentation allowlist. --check is read-only
apart from an optional report outside the source tree. Runtime gates remain unrun.
"""
from __future__ import annotations
import argparse, copy, hashlib, json, math, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

REVISION = '1.1'
STATES = ['queued','running','waiting-for-condition','waiting-for-model','waiting-for-user','paused','stopping','completed','failed','cancelled','lost','interrupted-after-possible-effect']
CONTROL = ['pending','active','revoking','quiescent','expired','closed']
ERRORS = ['UNAUTHORIZED','CONTROL_EXPIRED','RESOURCE_EXPIRED','STALE_TARGET','AMBIGUOUS_TARGET','FOCUS_CHANGED','USER_TAKEOVER','UNSUPPORTED_CAPABILITY','UNQUALIFIED_CAPABILITY','RESOURCE_LIMIT','CANCELLED','DEADLINE_EXCEEDED','REQUEST_CONFLICT','CHECKPOINT_EXPIRED','DELIVERY_UNCERTAIN','DEPENDENCY_CHANGED','INVALID_ARGUMENT','WORKSPACE_BUSY','WORKSPACE_LOST','DRIVER_LOST','BASE_EXPIRED','CLEANUP_FAILED','INTERNAL']
SUBMISSION = ['not_submitted','submitted','submission_uncertain']
EVIDENCE = ['not_checked','change_observed','no_change_observed','inconclusive']
OUTCOME = ['unverified','verified','failed']
PHASES = ['admission','validation','approach','dispatch','observation','checkpoint','cleanup','transport','guest']
DAG = {
 'W01': [], 'W02':['W01'], 'W03':['W02'], 'W04':['W02'], 'W05':['W01','W02'],
 'W06':['W03','W05'], 'W07':['W03','W06'], 'W08':['W05','W06'], 'W09':['W08','W06'],
 'W10':['W05','W09'], 'W11':['W06','W07','W09','W10'], 'W12':['W06','W07','W09'],
 'W13':['W06','W08'], 'W14':['W03','W13'], 'W15':['W06','W08'], 'W16':['W14','W15'],
 'W17':['W09','W15','W16'], 'W18':['W11','W13','W16','W17'], 'W19':['W11','W12','W18'],
 'W20':['W16','W17','W04'], 'W21':['W03','W04','W06'], 'W22':['W21','W07'],
 'W23':['W03','W17','W18','W19','W20','W22'], 'W24':['W06','W07','W22','W23'],
 'W25':['W24'], 'W26':['W24','W25'], 'W27':['W06','W24','W25'], 'W28':['W14','W24','W26','W27'],
 'W29':['W22','W23','W28'], 'W30':['W07','W22','W25','W28'],
 'W31':['W19','W24','W25','W26','W27','W28'], 'W32':['W05','W21','W26','W27'],
 'W33':['W31','W32'], 'W34':['W33'], 'W35':['W34','W28'],
 'W36':['W29','W30'], 'W37':['W20','W25','W34'], 'W38':['W32','W35'], 'W39':['W19','W32']
}
DOC_MAP = {
 '01':(['W01','W02'],['G01','G02','G03']), '02':(['W02','W03','W23'],['G02','G03']),
 '03':(['W04','W21','W22'],['G02']), '04':(['W04','W05','W21','W32'],['G01','G02']),
 '05':(['W06','W24'],['G04']), '06':(['W25'],['G08']), '07':(['W14','W16'],['G06','G07']),
 '08':(['W15'],['G07']), '09':(['W13','W14'],['G06']), '10':(['W20'],['G07']),
 '11':(['W17','W18'],['G07']), '12':(['W11','W19'],['G05']), '13':(['W12'],['G05']),
 '14':(['W10'],['G05']), '15':(['W08','W09','W11'],['G01','G05']), '16':(['W07'],['G10']),
 '17':(['W26'],['G03','G08']), '18':(['W27'],['G04']), '19':(['W28'],['G10']),
 '20':(['W01','W31','W33','W34'],['G09']), '21':(['W29'],['G11']), '22':(['W37'],['G11']),
 '23':(['W30'],['G11']), '24':(['W36'],['G11']), '25':(['W38'],['G12']),
 '26':(['W39'],['G12']), '27':(['W32','W35'],['G01','G03'])
}

def dump(value): return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n'
def obj(properties, required=None):
    return {'type':'object','properties':properties,'required': list(properties) if required is None else required,'additionalProperties':False}
def ref(name): return {'$ref':'#/$defs/'+name}
def sha(data): return hashlib.sha256(data).hexdigest()
def gitsha(data): return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()

def schemas():
    idv={'type':'string','minLength':1,'maxLength':128,'pattern':'^[A-Za-z][A-Za-z0-9_.:~-]*$'}
    counter={'type':'string','maxLength':20,'pattern':'^(0|[1-9][0-9]*)$'}
    rect=obj({'x':{'type':'number'},'y':{'type':'number'},'width':{'type':'number','exclusiveMinimum':0},'height':{'type':'number','exclusiveMinimum':0}})
    point=obj({'kind':{'const':'point'},'frameId':ref('id'),'transformGeneration':ref('counter'),'units':{'enum':['normalized','image-pixels','window-points','display-points']},'x':{'type':'number'},'y':{'type':'number'}})
    point['allOf']=[{'if':{'properties':{'units':{'const':'normalized'}}},'then':{'properties':{'x':{'minimum':0,'maximum':1},'y':{'minimum':0,'maximum':1}}}}]
    failure=obj({'code':{'enum':ERRORS},'message':{'type':'string','maxLength':4096},'phase':{'enum':PHASES},'executionId':ref('id'),'operationId':ref('id'),'submission':{'enum':SUBMISSION},'canRetryAutomatically':{'type':'boolean'},'details':{}},['code','message','phase','submission','canRetryAutomatically'])
    failure['allOf']=[{'if':{'properties':{'submission':{'enum':['submitted','submission_uncertain']}}},'then':{'properties':{'canRetryAutomatically':{'const':False}}}}]
    receipt=obj({'operationId':ref('id'),'executionId':ref('id'),'sequence':ref('counter'),'phase':{'enum':PHASES},'route':{'type':'string','minLength':1,'maxLength':128},'submission':{'enum':SUBMISSION},'evidence':{'enum':EVIDENCE},'outcome':{'enum':OUTCOME},'canRetryAutomatically':{'type':'boolean'},'target':obj({'appId':ref('id'),'windowId':ref('id'),'elementId':ref('id'),'surfaceId':ref('id')},['appId']),'after':ref('id'),'evidenceIds':{'type':'array','items':ref('id'),'uniqueItems':True,'maxItems':256},'verification':obj({'predicate':{'type':'string','minLength':1,'maxLength':2048},'evidenceIds':{'type':'array','minItems':1,'items':ref('id'),'uniqueItems':True}}),'failure':ref('failure')},['operationId','executionId','sequence','phase','route','submission','evidence','outcome','canRetryAutomatically','after','evidenceIds'])
    receipt['allOf']=[{'if':{'properties':{'submission':{'enum':['submitted','submission_uncertain']}}},'then':{'properties':{'canRetryAutomatically':{'const':False}}}}, {'if':{'properties':{'outcome':{'enum':['verified','failed']}}},'then':{'required':['verification'],'properties':{'evidenceIds':{'minItems':1}}}}]
    frame=obj({'id':ref('id'),'generation':ref('counter'),'parentId':ref('id'),'units':point['properties']['units'],'bounds':ref('rect'),'toParent':{'type':'array','minItems':6,'maxItems':6,'items':{'type':'number'}}},['id','generation','units','bounds','toParent'])
    checkpoint=obj({'id':ref('id'),'kind':{'enum':['model-decision','human-approval']},'executionId':ref('id'),'question':{'type':'string','minLength':1,'maxLength':8192},'schema':{'type':'object'},'evidenceIds':{'type':'array','items':ref('id'),'maxItems':256},'dependencyDigest':{'type':'string','pattern':'^[a-f0-9]{64}$'},'expiresAtMs':{'type':'integer','minimum':0}})
    native=obj({'apiRevision':{'const':REVISION},'requestId':ref('id'),'runtimeGeneration':ref('id'),'controlId':ref('id'),'controlEpoch':ref('counter'),'executionId':ref('id'),'operationId':ref('id'),'method':{'type':'string','minLength':1,'maxLength':128},'arguments':{'type':'object'}})
    values={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://cozea.invalid/aid-design/1.1/values.schema.json','title':'Transferable AID values; native method args additionally require generated method validation','$defs':{'id':idv,'counter':counter,'rect':rect,'point':point,'frame':frame,'failure':failure,'receipt':receipt,'checkpoint':checkpoint,'nativeRequest':native},'oneOf':[ref('point'),ref('frame'),ref('failure'),ref('receipt'),ref('checkpoint'),ref('nativeRequest')]}
    test=obj({'id':{'type':'string','minLength':1},'status':{'enum':['passed','failed','blocked','not_run','not_applicable']},'procedure':{'type':'string','minLength':1},'samples':{'type':'integer','minimum':0},'detail':{'type':'string'}},['id','status','procedure','samples'])
    evidence=obj({'id':{'type':'string','minLength':1},'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'kind':{'enum':['trace','image','video','test-output','manifest','review']},'access':{'enum':['public-redacted','private-consented']} })
    qual=obj({'schemaRevision':{'const':REVISION},'gateId':{'type':'string','pattern':'^G(0[1-9]|1[0-2])$'},'status':{'enum':['not_run','blocked','failed','passed','not_applicable']},'profileId':{'type':'string','minLength':1},'contractHash':{'type':'string','pattern':'^[a-f0-9]{64}$'},'sourceCommit':{'type':'string','pattern':'^[a-f0-9]{40}$'},'environment':{'type':'object','minProperties':1},'tests':{'type':'array','items':test},'evidence':{'type':'array','items':evidence},'rationale':{'type':'string','minLength':1},'reviewer':{'type':'string','minLength':1},'limitations':{'type':'array','items':{'type':'string'}},'startedAt':{'type':'string'},'finishedAt':{'type':'string'}},['schemaRevision','gateId','status','profileId','contractHash','sourceCommit','environment','tests','evidence','rationale','reviewer','limitations'])
    qual['$schema']='https://json-schema.org/draft/2020-12/schema';qual['$id']='https://cozea.invalid/aid-design/1.1/qualification.schema.json'
    qual['allOf']=[{'if':{'properties':{'status':{'const':'passed'}}},'then':{'required':['startedAt','finishedAt'],'properties':{'tests':{'minItems':1,'items':{'properties':{'status':{'const':'passed'},'samples':{'minimum':1}}}},'evidence':{'minItems':1}}}}, {'if':{'properties':{'status':{'const':'not_applicable'}}},'then':{'properties':{'gateId':{'enum':['G11','G12']}}}}]
    return values,qual

MACHINE={
 'revision':REVISION,
 'execution':{'initial':'queued','terminal':['completed','failed','cancelled','lost','interrupted-after-possible-effect'],'transitions':{
  'queued':['running','stopping','failed','lost'],
  'running':['waiting-for-condition','waiting-for-model','waiting-for-user','paused','stopping','completed','failed','lost','interrupted-after-possible-effect'],
  'waiting-for-condition':['running','stopping','failed','lost','interrupted-after-possible-effect'],
  'waiting-for-model':['running','stopping','failed','lost','interrupted-after-possible-effect'],
  'waiting-for-user':['running','stopping','failed','lost','interrupted-after-possible-effect'],
  'paused':['running','stopping','failed','lost'],
  'stopping':['cancelled','failed','lost','interrupted-after-possible-effect'],
  'completed':[],'failed':[],'cancelled':[],'lost':[],'interrupted-after-possible-effect':[]}},
 'control':{'initial':'pending','terminal':['closed'],'transitions':{
  'pending':['active','expired','closed'],'active':['revoking','expired'],
  'revoking':['quiescent','expired'],'quiescent':['closed'],'expired':['quiescent','closed'],'closed':[]}},
 'checkpoint':{'initial':'pending','terminal':['settled','expired','rejected','lost'],'transitions':{
  'pending':['accepted','expired','rejected','lost'],'accepted':['settled','rejected','lost'],
  'settled':[],'expired':[],'rejected':[],'lost':[]}},
 'invariants':[
  'Only active control with current epoch may admit a new effect.',
  'No held automation input at completed, failed, cancelled, lost or checkpoint publication; cleanup uncertainty is explicit.',
  'Control expired forbids admission but does not by itself confirm physical quiescence.',
  'Checkpoint answer accepted at most once; exact duplicate attaches; changed duplicate conflicts.',
  'Possible submission never permits automatic effect retry.',
  'A lost guest does not replay a prefix to restore its heap.'
 ]}

METHODS={
 'Resource':['describe'], 'Apps':['list','get','prepare'], 'App':['windows','activate','menu'],
 'Window':['focus','moveResize','refresh','observe','query'], 'Windows':['list','get','focused'],
 'QueryResult':['one'], 'Element':['refresh','perform','setValue','children'],
 'Observation':['query','point','crop','bindSurface','diff'], 'Surface':['point','validate','observe','release'],
 'Artifact':['read','release'], 'Observe':['window','surface'],
 'Pointer':['moveTo','moveBy','click','down','up','hover','followPath','scroll','withButtonDown','runTimeline'],
 'SurfacePointer':['stroke','click','moveTo'], 'Keyboard':['typeText','chord','keyDown','keyUp','withModifiers'],
 'Clipboard':['readText','write','withText'], 'Events':['until','watch','sleep'],
 'Watch':['next','close'], 'Execution':['emit','decide','requestApproval','receipt'],
 'Workspace':['modules','saveData','loadData'], 'Aid':['describe']
}
def method_metadata():
    rows=[]
    for interface,names in METHODS.items():
        for name in names:
            effect='evidence-read';cap='observe.read';where='native';cancellable=True
            if interface in ['Pointer','SurfacePointer']:effect='physical-input';cap='pointer.input'
            elif interface=='Keyboard':effect='physical-input';cap='keyboard.input'
            elif interface=='Clipboard':effect='clipboard-read' if name=='readText' else 'clipboard-write';cap=effect.replace('-','.')
            elif (interface,name) in [('Apps','prepare'),('App','activate'),('Window','focus'),('Window','moveResize')]:effect='window-mutation';cap='windows.control'
            elif interface=='Element' and name in ['perform','setValue']:effect='semantic-input';cap='accessibility.input'
            elif interface=='Workspace':effect='workspace-mutation' if name=='saveData' else 'evidence-read';cap='workspace.data';where='host'
            elif interface=='Execution':effect='supervisor';cap='execution.context';where='host'
            elif name in ['release','close']:effect='supervisor';cap='resource.release';where='host'
            if (interface,name) in [('Observation','query'),('Observation','point'),('Surface','point'),('QueryResult','one')]:effect='pure';cap='none';where='guest';cancellable=False
            if interface in ['Resource','Aid']:where='host';cap='describe'
            if interface=='Events':where='composite';cap='observe.watch'
            if name in ['withButtonDown','withModifiers','withText']:where='composite'
            rows.append({'interface':interface,'method':name,'effect':effect,'requiredCapability':cap,'cancellable':cancellable,'implementation':where,'nestedEffectsCheckedIndividually':where=='composite'})
    return {'apiRevision':REVISION,'note':'Design method metadata; production IDL also owns complete argument/result schemas. workspace-mutation is the explicit local-data effect addition in revision 1.1.','methods':rows}

EXAMPLES={
 'navigation.ts':'''import { aid } from "aid:runtime";
const prepared = await aid.apps.prepare({app:{bundleId:"com.apple.Safari"},launch:true,foreground:true});
await prepared.app.keyboard.chord(["command", "t"]);
await prepared.app.keyboard.typeText("https://example.com/");
await prepared.app.keyboard.chord(["Return"]);
const windows = await prepared.app.windows();
if (windows.length !== 1) throw new Error("Select an observed window explicitly; do not guess.");
const observation = await windows[0].observe({accessibility:true,image:false});
await aid.execution.emit({kind:"text",text:observation.text ?? "No AX text; inspect coverage."});
export const lastObservation = observation;
''',
 'drawing.ts':'''import { aid } from "aid:runtime";
import type { UnitPoint, Rect } from "aid:runtime";
// Fixture/application must actually expose this drawing mode; this does not run in docs CI.
const prepared = await aid.apps.prepare({app:{name:"AID Drawing Fixture"},foreground:true});
const windows = await prepared.app.windows();
if (windows.length !== 1) throw new Error("Select the intended window from actual evidence.");
const view=windows[0];
const tool=(await view.query({role:"AXButton",name:"Pencil"})).one();
await aid.pointer.click(tool);
const observed=await view.observe({accessibility:true,image:"overview"});
if (observed.images.length !== 1) throw new Error("Select a specific returned image.");
const answer=await aid.execution.decide<{x:number;y:number;width:number;height:number}>({
 question:"Identify the actual canvas rectangle in this image, excluding toolbar and borders.",
 observations:[observed],responseSchema:{type:"object",required:["x","y","width","height"],additionalProperties:false,
 properties:{x:{type:"number"},y:{type:"number"},width:{type:"number",exclusiveMinimum:0},height:{type:"number",exclusiveMinimum:0}}}
});
const rect:Rect=answer;
const canvas=await observed.bindSurface({image:observed.images[0],rect,units:"image-pixels",intent:"drawing",expectedTool:tool});
export function ellipse(cx:number,cy:number,rx:number,ry:number,n=80):UnitPoint[]{
 return Array.from({length:n+1},(_,i):UnitPoint=>{const a=i*2*Math.PI/n;return [cx+rx*Math.cos(a),cy+ry*Math.sin(a)];});
}
for(let i=0;i<20;i++) await canvas.pointer.stroke(ellipse(.5,.5,.08+i*.01,.1+i*.009),{durationMs:450,interpolation:"polyline"});
const after=await canvas.observe({image:"overview",accessibility:false});
for(const image of after.images) await aid.execution.emit({kind:"image",artifact:image});
''',
 'conditions.ts':'''import { aid } from "aid:runtime";
const prepared=await aid.apps.prepare({app:{name:"AID Player Fixture"},foreground:true});
const views=await prepared.app.windows();
if(views.length!==1) throw new Error("Window selection requires evidence.");
const view=views[0];
const button=await aid.events.until(async()=>{
 const result=await view.query({role:"AXButton",name:/^Skip( ad)?$/,enabled:true});
 return !result.truncated && result.items.length===1 ? result.one() : null;
},{scope:view,deadlineMs:30000});
const receipt=await aid.pointer.click(button);
const state=await view.observe({image:false,accessibility:true,after:receipt.after});
await aid.execution.emit({kind:"text",text:state.text??"No text evidence."});
''',
 'type-errors.ts':'''import { aid } from "aid:runtime";
import type { HostRequest } from "aid:runtime";
// @ts-expect-error Unframed coordinates are not a pointer target.
void aid.pointer.click([12,34]);
// @ts-expect-error Physical input is not a shell command device.
void aid.pointer.exec("rm -rf /tmp/example");
// @ts-expect-error Arbitrary principal injection is not an outer contract field.
const forged:HostRequest={method:"describe",params:{apiRevision:"1.1",subject:"pointer",principalId:"other"}};
void forged;
'''
}
AST_CHECK='''import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require(process.argv[2]);
const file=ts.createSourceFile('aid-sdk.d.ts',fs.readFileSync(process.argv[3],'utf8'),ts.ScriptTarget.Latest,true);
const methods=[];
function visit(node){
 if(ts.isInterfaceDeclaration(node)) for(const member of node.members) if(ts.isMethodSignature(member)) methods.push(node.name.text+'.'+member.name.getText(file));
 ts.forEachChild(node,visit);
}
visit(file);
process.stdout.write(JSON.stringify({methods:methods.sort(),diagnostics:file.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '))}));
'''

def vectors():
    receipt={'operationId':'op_1','executionId':'exec_1','sequence':'1','phase':'dispatch','route':'foreground-event','submission':'submitted','evidence':'not_checked','outcome':'unverified','canRetryAutomatically':False,'after':'op_1','evidenceIds':[]}
    point={'kind':'point','frameId':'frame_1','transformGeneration':'1','units':'normalized','x':.25,'y':.75}
    qualifier={'schemaRevision':REVISION,'gateId':'G01','status':'not_run','profileId':'macos26-arm64-candidate','contractHash':'0'*64,'sourceCommit':'0'*40,'environment':{'qualification':'not run by documentation'},'tests':[],'evidence':[],'rationale':'Design record only; no native test executed.','reviewer':'unassigned','limitations':['Runtime qualification not performed.']}
    good=[('describe','host',{'method':'describe','params':{'apiRevision':REVISION,'subject':'pointer'}}),('open','host',{'method':'open','params':{'apiRevision':REVISION,'idempotencyKey':'open_1','workspaceName':'drawing','control':{'mode':'visible-ui','targetApps':[{'name':'AID Drawing Fixture'}],'capabilities':['pointer.input','observe.read']}}}),('exec','host',{'method':'exec','params':{'apiRevision':REVISION,'workspaceId':'ws_1','idempotencyKey':'run_1','cellName':'geometry','source':{'kind':'text','text':'export const x = 1;'}}}),('inspect','host',{'method':'inspect','params':{'apiRevision':REVISION,'workspaceId':'ws_1','sinceSequence':'9007199254740993'}}),('respond','host',{'method':'respond','params':{'apiRevision':REVISION,'workspaceId':'ws_1','executionId':'exec_1','checkpointId':'cp_1','idempotencyKey':'answer_1','answer':'button_7'}}),('close','host',{'method':'close','params':{'apiRevision':REVISION,'target':{'kind':'execution','executionId':'exec_1'}}}),('point','values',point),('receipt','values',receipt),('gate-unrun','qualification',qualifier)]
    tests=[{'id':name,'schema':schema,'valid':True,'value':value} for name,schema,value in good]
    def bad(name,schema,value):tests.append({'id':name,'schema':schema,'valid':False,'value':value})
    x=copy.deepcopy(good[0][2]);x['params']['principalId']='foreign';bad('forged-owner-field','host',x)
    x=copy.deepcopy(good[2][2]);x['params']['source']={'kind':'text','text':'x','artifactId':'a'};bad('mixed-source','host',x)
    x=copy.deepcopy(good[2][2]);x['params']['cellName']='../../escape';bad('cell-path-traversal','host',x)
    x=copy.deepcopy(good[3][2]);x['params']['sinceSequence']=9007199254740993;bad('numeric-counter','host',x)
    x=copy.deepcopy(good[3][2]);x['params']['sinceSequence']='01';bad('leading-zero-counter','host',x)
    x=copy.deepcopy(good[5][2]);x['params']['target']['workspaceId']='ws_1';bad('mixed-close-target','host',x)
    x=copy.deepcopy(point);del x['frameId'];bad('unframed-point','values',x)
    x=copy.deepcopy(point);x['x']=1.5;bad('out-of-surface-point','values',x)
    x=copy.deepcopy(receipt);x['canRetryAutomatically']=True;bad('retry-after-submission','values',x)
    x=copy.deepcopy(receipt);x['submission']='submission_uncertain';x['canRetryAutomatically']=True;bad('retry-after-uncertainty','values',x)
    x=copy.deepcopy(receipt);x['outcome']='verified';bad('verified-without-evidence','values',x)
    x=copy.deepcopy(receipt);x['outcome']='failed';bad('failed-without-predicate','values',x)
    x=copy.deepcopy(qualifier);x['status']='passed';bad('gate-pass-with-no-tests','qualification',x)
    x=copy.deepcopy(qualifier);x['status']='not_applicable';bad('core-gate-not-applicable','qualification',x)
    return {'revision':REVISION,'note':'Schema vectors only; authentication/live-target checks are additional model/runtime cases.','tests':tests}

MODEL_TESTS='''"""Reference-model tests: these do NOT test macOS or the production runtime."""
import unittest
class Conflict(Exception):pass
class Revoked(Exception):pass
class Changed(Exception):pass
class Epoch:
 def __init__(self):self.value=1;self.active=True;self.effects=0
 def revoke(self):self.value+=1;self.active=False
 def admit(self,epoch):
  if not self.active or epoch!=self.value:raise Revoked()
  self.effects+=1
class Checkpoint:
 def __init__(self,dep):self.dep=dep;self.answer=None;self.settlements=0;self.result=None
 def respond(self,answer,current):
  if self.answer is not None:
   if self.answer!=answer:raise Conflict()
   return self.result
  self.answer=answer;self.settlements+=1
  self.result='dependency-changed' if current!=self.dep else 'resumed'
  return self.result
class Capture:
 def __init__(self):self.next=0;self.current=None;self.stopped=[]
 def acquire(self,owner):
  if self.current and self.current['state'] in ('starting','warm'):
   self.current['owners'].add(owner);self.current['borrows']+=1;return self.current
  self.next+=1;entry={'generation':self.next,'state':'starting','owners':{owner},'borrows':1};self.current=entry;return entry
 def release_owner(self,entry,owner):
  entry['owners'].discard(owner)
  if not entry['owners']:entry['state']='retiring';self.finish(entry)
 def release_borrow(self,entry):entry['borrows']-=1;self.finish(entry)
 def finish(self,entry):
  if entry['state']=='retiring' and not entry['borrows']:
   entry['state']='stopped';self.stopped.append(entry['generation'])
   if self.current is entry:self.current=None
 def complete_start(self,entry):
  if entry['owners'] and entry['state']=='starting':entry['state']='warm'
  else:self.finish(entry)
 def idle(self,entry):
  if not entry['owners'] and not entry['borrows']:entry['state']='retiring';self.finish(entry)
class Journal:
 def __init__(self):self.items={};self.effects=0
 def admit(self,key,digest):
  if key in self.items:
   if self.items[key]['digest']!=digest:raise Conflict()
   return self.items[key]
  item={'digest':digest,'submission':'not_submitted'};self.items[key]=item;return item
 def submit(self,item):
  if item['submission']!='not_submitted':raise Conflict()
  item['submission']='submission_uncertain';self.effects+=1
 def acknowledge(self,item):item['submission']='submitted'
class ModelTests(unittest.TestCase):
 def test_old_epoch_cannot_admit(self):
  x=Epoch();old=x.value;x.revoke()
  with self.assertRaises(Revoked):x.admit(old)
  self.assertEqual(x.effects,0)
 def test_new_grant_does_not_resurrect_old_epoch(self):
  x=Epoch();old=x.value;x.revoke();x.active=True
  with self.assertRaises(Revoked):x.admit(old)
  x.admit(x.value);self.assertEqual(x.effects,1)
 def test_checkpoint_exact_duplicate_once(self):
  x=Checkpoint('a');self.assertEqual(x.respond('yes','a'),'resumed');self.assertEqual(x.respond('yes','a'),'resumed');self.assertEqual(x.settlements,1)
 def test_checkpoint_conflict(self):
  x=Checkpoint('a');x.respond('yes','a')
  with self.assertRaises(Conflict):x.respond('no','a')
 def test_moved_target_duplicate_stays_rejected(self):
  x=Checkpoint('a');self.assertEqual(x.respond('yes','b'),'dependency-changed');self.assertEqual(x.respond('yes','a'),'dependency-changed');self.assertEqual(x.settlements,1)
 def test_owned_capture_not_idle_evicted(self):
  x=Capture();e=x.acquire('control');x.complete_start(e);x.release_borrow(e);x.idle(e);self.assertEqual(e['state'],'warm');self.assertEqual(x.stopped,[])
 def test_last_owner_waits_for_borrow(self):
  x=Capture();e=x.acquire('a');x.release_owner(e,'a');self.assertEqual(e['state'],'retiring');x.release_borrow(e);self.assertEqual(e['state'],'stopped')
 def test_late_start_cannot_replace_new_generation(self):
  x=Capture();old=x.acquire('a');x.release_owner(old,'a');new=x.acquire('b');x.release_borrow(old);x.complete_start(old);x.complete_start(new);self.assertIs(x.current,new);self.assertEqual(new['state'],'warm')
 def test_shared_owner_release_keeps_stream(self):
  x=Capture();e=x.acquire('a');x.acquire('b');x.complete_start(e);x.release_owner(e,'a');x.release_borrow(e);x.release_borrow(e);x.idle(e);self.assertEqual(e['owners'],{'b'});self.assertEqual(e['state'],'warm')
 def test_response_retry_attaches_without_effect(self):
  x=Journal();a=x.admit('k','h');x.submit(a);b=x.admit('k','h');self.assertIs(a,b);self.assertEqual(x.effects,1);self.assertEqual(b['submission'],'submission_uncertain')
 def test_idempotency_conflict(self):
  x=Journal();x.admit('k','h')
  with self.assertRaises(Conflict):x.admit('k','different')
 def test_ack_does_not_permit_replay(self):
  x=Journal();a=x.admit('k','h');x.submit(a);x.acknowledge(a)
  with self.assertRaises(Conflict):x.submit(a)
if __name__=='__main__':unittest.main()
'''

def normalized(text,number):
    # Explicit source-reference repair; original numbered register was absent.
    text=re.sub(r'\[[^\]]+\]\(29-research-register\.md(?:#[^)]*)?\)',f'[Primary evidence and limitations](29-research-register.md#d{number})',text)
    marker='> Revision 1.1 integration note:'
    if marker not in text:
        lines=text.splitlines(); insert=1
        note=(f'\n{marker} use [D31](31-design-reconciliation.md) for shared API/state/lifetime semantics, '
              f'[D28](28-implementation-roadmap.md) for work-package ordering, and '
              f'[D30](30-qualification-gates.md) for definitive gate IDs. '
              f'This subsystem contributes to {", ".join(DOC_MAP[number][1])}; '
              f'its implementation packages are {", ".join(DOC_MAP[number][0])}. '
              'Earlier illustrative spellings and unqualified new-platform claims are not competing implementation requirements.\n')
        lines.insert(insert,note);text='\n'.join(lines).rstrip()+'\n'
    return text

def anchors(text):
    result=set(re.findall(r'<a\s+id=[\"\']([^\"\']+)[\"\']',text));seen={}
    for line in re.findall(r'^#{1,6}\s+(.+)$',text,re.M):
        line=re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',line)
        name=re.sub(r'[^\w\s-]','',line.lower());name=re.sub(r'\s','-',name.strip())
        n=seen.get(name,0);seen[name]=n+1;result.add(name if n==0 else name+'-'+str(n))
    return result

def semantic(value):
    def walk(v,key=''):
        if isinstance(v,float) and (not math.isfinite(v) or (v==0 and math.copysign(1,v)<0)):raise ValueError('noncanonical number')
        if isinstance(v,dict):
            for k,x in v.items():walk(x,k)
        elif isinstance(v,list):
            for x in v:walk(x,key)
        elif isinstance(v,str) and key in ['sequence','sinceSequence','controlEpoch','generation','transformGeneration']:
            if not re.fullmatch(r'0|[1-9][0-9]*',v) or int(v)>2**64-1:raise ValueError('counter range')
    walk(value)
    if len(json.dumps(value,ensure_ascii=False,allow_nan=False).encode())>1024*1024:raise ValueError('control byte limit')
    if isinstance(value,dict) and value.get('outcome') in ['verified','failed']:
        ids=set(value.get('evidenceIds',[])); used=set(value.get('verification',{}).get('evidenceIds',[]))
        if not used or not used<=ids:raise ValueError('verification evidence mismatch')


def validate(root,report):
    d=root/'docs/aid-system';checks=[]
    def check(name,fn):
        try: detail=fn();checks.append({'check':name,'status':'passed','detail':detail})
        except Exception as e:checks.append({'check':name,'status':'failed','detail':str(e)})
    def links():
        broken=[];count=0
        for p in d.rglob('*.md'):
            text=p.read_text()
            for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)',text):
                if re.match(r'^[A-Za-z][A-Za-z0-9+.-]*:',target):continue
                path,_,anchor=target.partition('#');dest=(p.parent/path).resolve() if path else p.resolve();count+=1
                if not dest.exists():broken.append((str(p.relative_to(root)),target,'missing path'))
                elif anchor and dest.is_file() and dest.suffix=='.md' and anchor not in anchors(dest.read_text()):broken.append((str(p.relative_to(root)),target,'missing anchor'))
        if broken:raise ValueError(json.dumps(broken[:50]))
        return {'internalLinksChecked':count}
    check('internal-links-and-anchors',links)
    def graph():
        visiting=set();done=set()
        def visit(k):
            if k in visiting:raise ValueError('work-package cycle '+k)
            if k in done:return
            if k not in DAG:raise ValueError('unknown dependency '+k)
            visiting.add(k)
            for dep in DAG[k]:visit(dep)
            visiting.remove(k);done.add(k)
        for key in DAG:visit(key)
        for name,m in MACHINE.items():
            if not isinstance(m,dict) or 'transitions' not in m:continue
            table=m['transitions'];assert m['initial'] in table
            for state,targets in table.items():
                assert all(x in table for x in targets),(state,targets)
                if state in m['terminal']:assert not targets,state
        return {'workPackages':len(done),'stateMachines':3,'runtimeGates':'not_run'}
    check('dependency-and-state-graphs',graph)
    def schema_tests():
        import jsonschema
        schema_by={name:json.loads((d/'contracts'/filename).read_text()) for name,filename in [('host','host.schema.json'),('values','values.schema.json'),('qualification','qualification.schema.json')]}
        for s in schema_by.values():jsonschema.Draft202012Validator.check_schema(s)
        count=0
        for row in vectors()['tests']:
            ok=True
            try:jsonschema.Draft202012Validator(schema_by[row['schema']]).validate(row['value']);semantic(row['value'])
            except (jsonschema.ValidationError,ValueError):ok=False
            if ok!=row['valid']:raise ValueError('unexpected vector result '+row['id'])
            count+=1
        for bad in [{'sequence':str(2**64)},{'x':float('nan')},{'x':float('inf')},{'x':-0.0}]:
            try:semantic(bad)
            except ValueError:count+=1
            else:raise ValueError('semantic validator accepted '+repr(bad))
        return {'schemas':len(schema_by),'vectorsIncludingSemanticNegatives':count,'validator':'jsonschema Draft202012Validator','authorityTests':'separate design model/native gates'}
    check('schemas-and-semantic-vectors',schema_tests)
    def model_tests():
        p=subprocess.run([sys.executable,str(d/'tools/test_design_models.py')],capture_output=True,text=True,timeout=30)
        if p.returncode:raise ValueError(p.stdout+p.stderr)
        return {'suite':'pure design models, not native runtime','output':p.stderr.strip()}
    check('cross-subsystem-reference-models',model_tests)
    def types():
        ts=os.environ.get('AID_TYPESCRIPT_PATH')
        if not ts:
            tsc=shutil.which('tsc')
            if tsc:ts=str(Path(tsc).resolve().parent.parent/'lib/typescript.js')
        if not ts or not Path(ts).is_file():raise ValueError('TypeScript unavailable; run the pinned documentation CI environment. No typecheck pass claimed.')
        tscjs=Path(ts).parent/'tsc.js';node=shutil.which('node')
        if not node:raise ValueError('Node executable unavailable for TypeScript tooling.')
        files=[str(d/'contracts/aid-sdk.d.ts')]+[str(p) for p in sorted((d/'contracts/examples').glob('*.ts'))]
        cmd=[node,str(tscjs),'--strict','--noEmit','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--lib','ES2022',*files]
        p=subprocess.run(cmd,capture_output=True,text=True,timeout=60)
        if p.returncode:raise ValueError(p.stdout+p.stderr)
        q=subprocess.run([node,str(d/'tools/ast-check.mjs'),ts,str(d/'contracts/aid-sdk.d.ts')],capture_output=True,text=True,timeout=30)
        if q.returncode:raise ValueError(q.stderr)
        ast=json.loads(q.stdout)
        assert not ast['diagnostics'],ast['diagnostics']
        expected=sorted(i+'.'+n for i,ns in METHODS.items() for n in ns)
        assert ast['methods']==expected,{'missingMetadata':sorted(set(ast['methods'])-set(expected)),'missingMethods':sorted(set(expected)-set(ast['methods']))}
        version=subprocess.run([node,str(tscjs),'--version'],capture_output=True,text=True,timeout=20).stdout.strip()
        return {'typescript':version,'exampleFiles':len(files)-1,'sdkMethodsWithMetadata':len(expected),'command':cmd,'runtimeExecuted':False}
    check('typescript-examples-and-method-coverage',types)
    def required():
        paths=['MASTER.md']+[f'{i:02d}' for i in range(1,32)]
        md=list(d.glob('*.md'))
        for item in paths:
            assert any(p.name==item or p.name.startswith(item+'-') for p in md),'missing '+item
        for name in ['README.md','aid-sdk.d.ts','host.schema.json','values.schema.json','qualification.schema.json','state-machines.json','method-metadata.json','test-vectors.json']:
            assert (d/'contracts'/name).is_file(),'missing contract '+name
        return {'numberedSubsystemDesigns':31,'master':True,'contractArtifacts':8}
    check('deliverable-inventory',required)
    report.update({'revision':REVISION,'checks':checks,'allDesignChecksPassed':all(x['status']=='passed' for x in checks),'runtimeGates':{f'G{i:02d}':'not_run' for i in range(1,13)},'nativeTestsRun':False,'providerTestsRun':False,'desktopInputSent':False,'researchNote':'Source retrieval/keyword metadata is not treated as semantic verification or runtime qualification.'})
    return report


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--root',default='.');parser.add_argument('--write',action='store_true');parser.add_argument('--check',action='store_true');parser.add_argument('--report');args=parser.parse_args()
    root=Path(args.root).resolve();d=root/'docs/aid-system';assert d.is_dir(),'Recovered corpus is required; never generate an empty substitute.'
    originals=sorted(p for p in d.glob('*.md') if re.match(r'^(0[1-9]|1[0-9]|2[0-7])-.*\.md$',p.name))
    assert len(originals)==27,'Expected the 27 recovered subsystem documents.'
    generated={}
    values,qual=schemas()
    generated['contracts/values.schema.json']=dump(values)
    generated['contracts/qualification.schema.json']=dump(qual)
    generated['contracts/state-machines.json']=dump(MACHINE)
    generated['contracts/method-metadata.json']=dump(method_metadata())
    generated['contracts/test-vectors.json']=dump(vectors())
    generated['contracts/examples/README.md']='# Canonical SDK examples\n\nThese programs are typechecked only. They do not execute desktop input during documentation validation. They require an authorized live AID runtime and actual observed fixture/application targets during implementation qualification. `type-errors.ts` contains intentional compile rejections. Named-module persistence is specified in D03; these examples do not claim an implementation already exists.\n'
    for name,text in EXAMPLES.items():generated['contracts/examples/'+name]=text
    generated['tools/ast-check.mjs']=AST_CHECK
    generated['tools/test_design_models.py']=MODEL_TESTS
    generated['implementation-dependencies.json']=dump({'revision':REVISION,'packages':DAG,'optional':['W29','W30','W36','W37','W38','W39'],'cutoverGates':[f'G{i:02d}' for i in range(1,11)]})
    changes=[]
    for p in originals:
        text=normalized(p.read_text(),p.name[:2])
        if text!=p.read_text():changes.append(str(p.relative_to(root)))
        if args.write:p.write_text(text)
        elif text!=p.read_text():raise SystemExit('Normalization drift: '+str(p))
    for name,text in generated.items():
        p=d/name
        if args.write:p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
        elif not p.is_file() or p.read_text()!=text:raise SystemExit('Generated design drift: '+str(p))
    master=d/'MASTER.md';text=master.read_text()
    marker='## Revision 1.1 completion and reading order'
    if marker not in text:
        text+='\n\n'+marker+'\n\nRead [D31](31-design-reconciliation.md) for the reconciled shared contracts, [D28](28-implementation-roadmap.md) for executable work orders, [D29](29-research-register.md) for primary evidence/adoption limits, and [D30](30-qualification-gates.md) for definitive empirical gates. The [contract artifacts](contracts/README.md) and [handoff guide](HANDOFF.md) are present rather than placeholders. Earlier illustrative names and specific unqualified future-platform claims are not competing normative APIs. Pure workspace retention is distinct from active control/capture authority. This documentation revision does not assert native, provider, sandbox or performance qualification.\n'
    text=text.replace('**Design revision:** 1.0','**Design revision:** 1.1')
    if args.write:master.write_text(text)
    elif text!=master.read_text():raise SystemExit('Master revision drift')
    trace=[]
    for p in originals:
        text=p.read_text();number=p.name[:2]
        for match in re.finditer(r'\*\*([A-Z][A-Z0-9]+-\d{2,3}):\*\*\s*',text):
            end=text.find('**',match.end());desc=text[match.end():end if end>=0 else min(len(text),match.end()+800)].strip()
            trace.append({'id':match.group(1),'owner':p.name,'requirement':desc,'workPackages':DOC_MAP[number][0],'gates':DOC_MAP[number][1],'status':'specified-not-implemented'})
    generated_trace=d/'requirement-traceability.json'
    if args.write:generated_trace.write_text(dump({'revision':REVISION,'requirements':trace,'note':'Per-subsystem acceptance criteria mapped to implementation packages/gates. No runtime pass implied.'}))
    # Handoff exists before link validation; the report, not this text, states outcomes.
    handoff='# AID design handoff — revision 1.1\n\nStart at [MASTER](MASTER.md), then read [D31](31-design-reconciliation.md), [D28](28-implementation-roadmap.md), [D30](30-qualification-gates.md), and the owning subsystem documents. Contracts/examples are under [contracts](contracts/README.md); primary references and qualifications are in [D29](29-research-register.md).\n\nThe preserved 27 subsystem designs are the foundation. The roadmap, research register, qualification gates, reconciliation and contract files are newly completed material, not claims of recovering unsaved originals. The target remains programmable visible macOS devices, not task macros or hidden terminal work. Public npm/standalone-MCP distribution is deferred.\n\nRun `python docs/aid-system/tools/finalize_design.py --root . --check --report /tmp/aid-design-validation.json` in the pinned documentation environment (Python with jsonschema, Node and TypeScript). `--check` does not alter source files. `--write` regenerates only the explicit documentation artifacts and source-reference/read-order notes; it never modifies runtime source or sends input.\n\nInspect `design-validation.json` for actual pass/fail results and tool versions. These checks include link/anchor closure, schema/semantic negative vectors, pure cross-subsystem design models, TypeScript examples and method metadata, dependency/state graphs and deliverable presence. They do not run native input, TCC, sandbox, provider or performance qualification. G01–G12 remain explicitly unrun until implementation produces evidence.\n\nDo not rely on the earlier empty downloadable recovery bundle. A valid final export includes the full corpus, hashes and a nonempty validation report. The repository publication report from the recovery pass is historical; it is not silently rewritten as current qualification.\n'
    if args.write:(d/'HANDOFF.md').write_text(handoff)
    elif not (d/'HANDOFF.md').exists():raise SystemExit('Handoff missing')
    report={'documentationOnly':True,'recoveredSubsystemFiles':len(originals),'newCompletionNotRecovered':True,'sourceReferenceRepairs':changes}
    report=validate(root,report)
    target=Path(args.report) if args.report else (d/'design-validation.json' if args.write else None)
    if target:target.parent.mkdir(parents=True,exist_ok=True);target.write_text(dump(report))
    if args.write:
        files=[]
        for p in sorted(d.rglob('*')):
            if not p.is_file() or p.name in ['DESIGN-MANIFEST.json','design-validation.json'] or '__pycache__' in p.parts:continue
            data=p.read_bytes();files.append({'path':str(p.relative_to(root)),'bytes':len(data),'sha256':sha(data),'gitBlobSha':gitsha(data)})
        (d/'DESIGN-MANIFEST.json').write_text(dump({'revision':REVISION,'files':files,'validationReport':'docs/aid-system/design-validation.json','runtimeQualification':'not_run'}))
    print(dump(report))
    return 0 if report['allDesignChecksPassed'] else 1
if __name__=='__main__':raise SystemExit(main())
