#!/usr/bin/env python3
"""Complete and check the remaining cross-contract invariants; documentation only.

Requires the preserved corpus and the preceding revision-1.1 completion tools.
This is not a native runtime, a network research verdict, or an execution engine.
"""
from __future__ import annotations
import argparse, copy, hashlib, importlib.util, json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('aid_finalize', HERE / 'finalize_design.py')
F = importlib.util.module_from_spec(spec)
spec.loader.exec_module(F)

ADDENDUM = r'''

## R19 — Replay protection outlives response retention

Execution idempotency keys are scoped to an authenticated owner and a workspace generation. A repeated key with the same admitted source/argument digest must attach to that same execution; a repeated key with different content must fail `REQUEST_CONFLICT`. This invariant must survive expiration of large receipts, logs, checkpoint evidence and provider response bodies.

Keep a compact durable admission index for the life of the workspace generation: key digest, request digest, execution identity and terminal/uncertain summary. Response retention and replay protection are separate stores. Expiring an old response must never convert an old key into permission to submit the effect again. If details expire, return a terminal summary with `historyExpired:true`; do not start a replacement execution. A crashed workspace generation remains closed/lost and rejects old effects. A new workspace has a new identity; choosing to execute again there is explicit, not recovery replay.

The compact index is resource bounded by admission, not unsafe eviction. If its configured quota is exhausted, reject new admissions with `RESOURCE_LIMIT` before desktop effects. The trusted host may raise storage limits or close/archive that workspace explicitly. Do not remove old admission keys from a still-live namespace to make room. Server-generated monotonic sequence numbers can index records, but they do not replace the mapping from caller retry keys to the originally admitted execution.

Checkpoint response keys obey the same distinction. Completed continuations may discard large evidence under policy while retaining a terminal answer digest and execution outcome. A late duplicate must return the terminal status or a precise expired-detail error. It cannot recreate or resume a settled promise. Conflicting duplicates remain conflicts while their owning namespace is accepted.

No design promises exactly-once arbitrary GUI effects. This rule provides at-most-once admission under stable scoped identities and preserves uncertainty after a possible dispatch. It closes a storage-retention hole; it does not make OS event submission atomic with the journal.

**JRN-R01:** expire all large result bodies, retry the old key, and assert the effect count is unchanged. **JRN-R02:** fill the admission index, request a new effect, and assert rejection occurs before submission. **JRN-R03:** retry an old key after quota pressure and assert it still resolves to the original execution. **JRN-R04:** restart with a lost/closed workspace generation and assert an old request cannot reopen it. W07 owns these tests; G10 qualifies the production implementation.

## R20 — Typed host results and image transport

The outer result union is fixed by `contracts/aid-sdk.d.ts` and `contracts/results.schema.json`. A successful outer request returns one of `opened`, `execution`, `inspection`, `closing`, or `description`; failure returns `error`. Unknown variants fail contract validation rather than being converted to free-form success text.

Execution emissions are a discriminated union: text, structured JSON data, or a descriptor for an authorized image artifact. A wire artifact descriptor contains immutable identity, runtime generation, MIME type, byte length, digest, expiry and image/evidence geometry where applicable. It contains no arbitrary local path, download URL, native pointer or host credential. The provider adapter resolves bytes through the authenticated artifact service and emits the provider's actual supported image content. Serializing the descriptor or base64 as text is not vision delivery.

The descriptor does not itself grant access. Host and native services recheck owner, scope, generation, export permission and retention before transfer. Image dimensions must agree with the selected transformed artifact, not the original full-window frame. Expiration is explicit; a lost image may not be silently replaced with a newer screenshot under the same observation ID.

Schemas validate result shape and receipt evidence requirements. Runtime validation additionally checks that evidence IDs exist in the authorized store, point to the claimed observations and satisfy the named predicate's semantics. An attacker can construct JSON shaped like a verified receipt; only a trusted native/host producer can attest to its actual result.

`requestApproval` records a human decision through a trusted host surface. The guest-facing approved boolean is not a capability token and cannot upgrade a grant. When host policy requires approval for an exact effect, the native/host admission path binds the checkpoint to the canonical operation arguments, target, mode, epoch and intended effect digest before any submission. Changed arguments or dependencies require reapproval/revalidation. A guest-generated description alone is not a sufficient authorization record.

The generated production IDL must produce both requests and results, including the above union and method-specific arguments. Documentation examples and positive/negative result vectors are conformance inputs, not permission to leave production responses as unchecked `unknown` values.
'''

TS_DESCRIPTOR = '''
  /** Wire metadata only; authority and byte transfer remain with the host. */
  export interface ArtifactDescriptor {
    readonly kind: "artifact";
    readonly id: ArtifactId;
    readonly runtimeGeneration: string;
    readonly mimeType: string;
    readonly byteLength: number;
    readonly sha256: string;
    readonly expiresAtMs: number;
    readonly pixelWidth?: number;
    readonly pixelHeight?: number;
    readonly observationId?: ObservationId;
  }
  export type WireEmission =
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "image"; readonly artifact: ArtifactDescriptor }
    | { readonly kind: "data"; readonly value: JSONValue };
'''


def result_schema(values, host):
    o, r = F.obj, F.ref
    defs = copy.deepcopy(values['$defs'])
    defs['json'] = copy.deepcopy(host['$defs']['json'])
    defs['closeTarget'] = copy.deepcopy(host['$defs']['closeTarget'])
    defs['artifact'] = o({
      'kind': {'const':'artifact'}, 'id':r('id'), 'runtimeGeneration':r('id'),
      'mimeType': {'type':'string','minLength':1,'maxLength':128},
      'byteLength': {'type':'integer','minimum':0,'maximum':1073741824},
      'sha256': {'type':'string','pattern':'^[a-f0-9]{64}$'},
      'expiresAtMs': {'type':'integer','minimum':0},
      'pixelWidth': {'type':'integer','minimum':1}, 'pixelHeight': {'type':'integer','minimum':1},
      'observationId':r('id')
    }, ['kind','id','runtimeGeneration','mimeType','byteLength','sha256','expiresAtMs'])
    defs['emission'] = {'oneOf':[
      o({'kind':{'const':'text'},'text':{'type':'string','maxLength':262144}}),
      o({'kind':{'const':'data'},'value':r('json')}),
      o({'kind':{'const':'image'},'artifact':r('artifact')})
    ]}
    defs['capability'] = o({
      'name':{'type':'string','minLength':1},'supported':{'type':'boolean'},
      'qualified':{'type':'boolean'},'granted':{'type':'boolean'},'currentlyAvailable':{'type':'boolean'},
      'reason':{'type':'string'},'limits':r('json'),'qualificationProfile':{'type':'string'}
    },['name','supported','qualified','granted','currentlyAvailable'])
    defs['description'] = o({
      'apiRevision':{'const':'1.1'},'contractHash':{'type':'string','pattern':'^[a-f0-9]{64}$'},
      'subject':{'type':'string'},'capabilities':{'type':'array','items':r('capability')},
      'types':{'type':'string'},'examples':{'type':'array','items':{'type':'string'}},
      'limitations':{'type':'array','items':{'type':'string'}}
    })
    defs['executionStatus'] = o({
      'executionId':r('id'),'workspaceId':r('id'),'state':{'enum':F.STATES},
      'sequence':r('counter'),'checkpoint':r('checkpoint'),'lastReceipt':r('receipt'),
      'failure':r('failure'),'historyExpired':{'type':'boolean'},
      'droppedRecords':{'type':'integer','minimum':0}
    },['executionId','workspaceId','state','sequence','historyExpired','droppedRecords'])
    defs['controlStatus'] = o({
      'controlId':r('id'),'epoch':r('counter'),'state':{'enum':F.CONTROL},
      'mode':{'enum':['visible-ui','physical-ui','hybrid']},'quiescent':{'type':'boolean'}
    })
    defs['opened'] = o({
      'kind':{'const':'opened'},'workspaceId':r('id'),'control':r('controlStatus'),
      'apiRevision':{'const':'1.1'},'contractHash':{'type':'string','pattern':'^[a-f0-9]{64}$'}
    },['kind','workspaceId','apiRevision','contractHash'])
    defs['execution'] = o({'kind':{'const':'execution'},'status':r('executionStatus'),
      'emissions':{'type':'array','maxItems':1024,'items':r('emission')}})
    defs['inspection'] = o({'kind':{'const':'inspection'},
      'executions':{'type':'array','items':r('executionStatus')},
      'modules':{'type':'array','items':o({'name':{'type':'string'},'revision':{'type':'string'}})}})
    defs['closing'] = o({'kind':{'const':'closing'},'target':r('closeTarget'),'quiescent':{'type':'boolean'}})
    defs['described'] = o({'kind':{'const':'description'},'description':r('description')})
    defs['error'] = o({'kind':{'const':'error'},'failure':r('failure')})
    return {'$schema':'https://json-schema.org/draft/2020-12/schema',
      '$id':'https://cozea.invalid/aid-design/1.1/results.schema.json',
      'title':'Protocol-neutral typed AID results — revision 1.1',
      'description':'No network resolution. Runtime provenance, ownership and evidence checks are additional requirements.',
      '$defs':defs,'oneOf':[r(x) for x in ['opened','execution','inspection','closing','described','error']]}


def response_vectors():
    status={'executionId':'exec_1','workspaceId':'ws_1','state':'running','sequence':'1','historyExpired':False,'droppedRecords':0}
    descriptor={'kind':'artifact','id':'artifact_1','runtimeGeneration':'runtime_1','mimeType':'image/png',
      'byteLength':64,'sha256':'0'*64,'expiresAtMs':2000000000000,'pixelWidth':64,'pixelHeight':64,'observationId':'obs_1'}
    good=[
      {'kind':'opened','workspaceId':'ws_1','apiRevision':'1.1','contractHash':'0'*64},
      {'kind':'execution','status':status,'emissions':[{'kind':'text','text':'Actual result metadata.'}]},
      {'kind':'execution','status':status,'emissions':[{'kind':'image','artifact':descriptor}]},
      {'kind':'inspection','executions':[status],'modules':[{'name':'geometry','revision':'r1'}]},
      {'kind':'closing','target':{'kind':'execution','executionId':'exec_1'},'quiescent':False},
      {'kind':'description','description':{'apiRevision':'1.1','contractHash':'0'*64,'subject':'pointer',
        'capabilities':[],'types':'interface Pointer {}','examples':[],'limitations':['Fixture only']}},
      {'kind':'error','failure':{'code':'DELIVERY_UNCERTAIN','message':'May have been submitted.',
        'phase':'dispatch','submission':'submission_uncertain','canRetryAutomatically':False}}
    ]
    rows=[{'id':f'valid-result-{i+1}','valid':True,'value':x} for i,x in enumerate(good)]
    def bad(name,value):rows.append({'id':name,'valid':False,'value':value})
    x=copy.deepcopy(good[2]);x['emissions'][0]['artifact']['path']='/private/screenshot.png';bad('raw-path-in-artifact',x)
    x=copy.deepcopy(good[2]);x['emissions'][0]={'kind':'image','data':'base64-is-not-an-artifact'};bad('image-bypasses-artifact-service',x)
    x=copy.deepcopy(good[1]);x['status']['state']='done-ish';bad('unknown-execution-state',x)
    x=copy.deepcopy(good[-1]);x['failure']['canRetryAutomatically']=True;bad('retry-uncertain-result',x)
    x=copy.deepcopy(good[0]);x['principalId']='someone-else';bad('unrecognized-owner-result-field',x)
    return {'apiRevision':'1.1','tests':rows,'runtimeProvenanceVerified':False}


TEST = r'''"""Bounded reference model: replay index is distinct from cached responses."""
import unittest
class Conflict(Exception):pass
class Full(Exception):pass
class Closed(Exception):pass
class AdmissionIndex:
 def __init__(self,limit=2):self.limit=limit;self.keys={};self.results={};self.effects=0;self.closed=False
 def admit(self,key,digest):
  if self.closed:raise Closed()
  if key in self.keys:
   if self.keys[key]['digest']!=digest:raise Conflict()
   return self.keys[key]
  if len(self.keys)>=self.limit:raise Full()
  value={'digest':digest,'execution':len(self.keys)+1,'submission':'not_submitted'}
  self.keys[key]=value
  return value
 def submit(self,key):
  value=self.keys[key]
  if value['submission']!='not_submitted':raise Conflict()
  value['submission']='submission_uncertain';self.effects+=1
 def evict_response(self,key):self.results.pop(key,None)
class RetentionTests(unittest.TestCase):
 def test_evicted_response_does_not_erase_admission(self):
  x=AdmissionIndex();first=x.admit('k','h');x.submit('k');x.results['k']='large';x.evict_response('k')
  self.assertIs(x.admit('k','h'),first);self.assertEqual(x.effects,1)
 def test_full_index_rejects_before_effect(self):
  x=AdmissionIndex(1);x.admit('k','h');x.submit('k')
  with self.assertRaises(Full):x.admit('new','other')
  self.assertEqual(x.effects,1)
 def test_quota_pressure_keeps_old_key(self):
  x=AdmissionIndex(1);first=x.admit('k','h')
  with self.assertRaises(Full):x.admit('new','other')
  self.assertIs(x.admit('k','h'),first)
 def test_expired_details_do_not_allow_changed_digest(self):
  x=AdmissionIndex();x.admit('k','h');x.evict_response('k')
  with self.assertRaises(Conflict):x.admit('k','changed')
 def test_closed_generation_cannot_reopen_on_retry(self):
  x=AdmissionIndex();x.admit('k','h');x.closed=True
  with self.assertRaises(Closed):x.admit('k','h')
 def test_live_index_does_not_repeat_possible_effect(self):
  x=AdmissionIndex();x.admit('k','h');x.submit('k');x.evict_response('k')
  with self.assertRaises(Conflict):x.submit('k')
  self.assertEqual(x.effects,1)
if __name__=='__main__':unittest.main()
'''


def put(path,text):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(text,encoding='utf-8')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',default='.')
    parser.add_argument('--write',action='store_true')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    root=Path(args.root).resolve();d=root/'docs/aid-system'
    assert len(list(d.glob('[0-2][0-9]-*.md'))) >= 29, 'Require the original corpus and completed roadmap/register.'
    sdk=d/'contracts/aid-sdk.d.ts';reconcile=d/'31-design-reconciliation.md';readme=d/'contracts/README.md'
    text=sdk.read_text()
    if 'export interface ArtifactDescriptor' not in text:
        anchor='  export type HostResult ='
        assert text.count(anchor)==1, 'SDK result declaration moved; inspect before changing.'
        text=text.replace(anchor,TS_DESCRIPTOR+'\n'+anchor)
    text=text.replace('readonly emissions: readonly JSONValue[]','readonly emissions: readonly WireEmission[]')
    if args.write:
        put(sdk,text)
        s=reconcile.read_text()
        if '## R19 — Replay protection outlives response retention' not in s:put(reconcile,s+ADDENDUM)
        s=readme.read_text()
        if '[`results.schema.json`]' not in s:
            s+='\n## Typed results and effect retention completion\n\n[`results.schema.json`](results.schema.json) and [`result-vectors.json`](result-vectors.json) close the outer result contract. R19/R20 in [D31](../31-design-reconciliation.md) separate replay-protection retention from response caching, and require authenticated image descriptors rather than paths/base64 text. `tools/test_effect_retention.py` is a pure design-model test, not runtime qualification. The integrity audit is independently run after the ordinary design validator.\n'
            put(readme,s)
        for name in ['16-journal-recovery.md','06-continuations-checkpoints.md']:
            p=d/name;s=p.read_text()
            marker='## Revision 1.1 durable replay-index rule'
            if marker not in s:
                put(p,s+'\n\n'+marker+'\n\nApply D31 R19: retain compact request/answer admission identities for the life of their accepted workspace generation, separately from expirable result bodies. Capacity exhaustion rejects new admission instead of evicting a key that could authorize replay. Closed/lost generations reject old work. An expired response or checkpoint artifact cannot make a settled operation new again. W07/G10 own the retention tests.\n')
        put(d/'tools/test_effect_retention.py',TEST)
    else:
        assert text==sdk.read_text(),'SDK result contract drift'
        assert '## R19 — Replay protection outlives response retention' in reconcile.read_text()
    values=json.loads((d/'contracts/values.schema.json').read_text())
    host=json.loads((d/'contracts/host.schema.json').read_text())
    result=result_schema(values,host);vectors=response_vectors()
    for name,value in [('results.schema.json',result),('result-vectors.json',vectors)]:
        path=d/'contracts'/name
        if args.write:put(path,F.dump(value))
        else:assert json.loads(path.read_text())==value, name+' drift'
    import jsonschema
    jsonschema.Draft202012Validator.check_schema(result)
    for row in vectors['tests']:
        valid=True
        try:jsonschema.Draft202012Validator(result).validate(row['value']);F.semantic(row['value'])
        except (jsonschema.ValidationError,ValueError):valid=False
        assert valid==row['valid'],row['id']
    proc=subprocess.run([sys.executable,str(d/'tools/test_effect_retention.py')],capture_output=True,text=True,timeout=30)
    assert proc.returncode==0,proc.stdout+proc.stderr
    # Re-run the full original suite after these type/document changes.
    report={}
    F.validate(root,report)
    assert report['allDesignChecksPassed'],F.dump(report)
    report['checks'].append({'check':'typed-host-results-and-replay-retention','status':'passed','detail':{
       'resultVectors':len(vectors['tests']),'retentionModelOutput':proc.stderr.strip(),
       'runtimeExecuted':False,'resultSchema':'contracts/results.schema.json'}})
    report['allDesignChecksPassed']=all(x['status']=='passed' for x in report['checks'])
    report['designScope']='Preserved corpus plus newly completed revision-1.1 contracts; not reconstructed exact unsaved wording.'
    report['semanticResearchQualification']='Primary-reference retrieval alone is not a full semantic literature review. Newer-version adoption remains gated.'
    if args.write:
        put(d/'design-validation.json',F.dump(report))
        entries=[]
        for path in sorted(d.rglob('*')):
            if not path.is_file() or path.name in ['DESIGN-MANIFEST.json','design-validation.json'] or '__pycache__' in path.parts:continue
            raw=path.read_bytes()
            entries.append({'path':str(path.relative_to(root)),'bytes':len(raw),'sha256':F.sha(raw),'gitBlobSha':F.gitsha(raw)})
        put(d/'DESIGN-MANIFEST.json',F.dump({'revision':'1.1','files':entries,'validationReport':'docs/aid-system/design-validation.json','runtimeQualification':'not_run'}))
    print(F.dump(report))
    return 0
if __name__=='__main__':raise SystemExit(main())
