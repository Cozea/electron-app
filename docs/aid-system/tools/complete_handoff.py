#!/usr/bin/env python3
"""Documentation-only completion/export. No desktop or production operations.

Builds explicit schema artifacts, normalizes documentation references, invokes
strict validation and exports a manifest-verified nonempty corpus. Research URL
retrieval is recorded honestly; it is not treated as runtime/semantic proof.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, importlib.util, json, os, re, shutil, subprocess, sys, time, urllib.request, zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('aid_design_finalize',HERE/'finalize_design.py')
F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)

def write(path,text):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text,encoding='utf8')
def jsonout(path,data):write(path,F.dump(data))

def host_schema():
    defs={
      'id':{'type':'string','minLength':1,'maxLength':128,'pattern':'^[A-Za-z][A-Za-z0-9_.:~-]*$'},
      'key':{'type':'string','minLength':1,'maxLength':128,'pattern':'^[A-Za-z0-9_.:~-]+$'},
      'counter':{'type':'string','maxLength':20,'pattern':'^(0|[1-9][0-9]*)$'},
      'revision':{'const':F.REVISION}, 'hash':{'type':'string','pattern':'^[a-f0-9]{64}$'},
      'name':{'type':'string','minLength':1,'maxLength':64,'pattern':'^[A-Za-z0-9][A-Za-z0-9_.-]*$'},
      'mode':{'enum':['visible-ui','physical-ui','hybrid']}
    }
    r=F.ref;o=F.obj
    defs['json']={'oneOf':[{'type':'null'},{'type':'boolean'},{'type':'number'},{'type':'string'},{'type':'array','items':r('json')},{'type':'object','additionalProperties':r('json')}]}
    bounded={'type':'string','minLength':1,'maxLength':512}
    defs['app']={'oneOf':[o({'bundleId':bounded}),o({'name':bounded}),o({'pid':{'type':'integer','minimum':1,'maximum':2147483647},'launchIdentity':{'type':'string','minLength':1,'maxLength':256}})]}
    defs['controlRequest']=o({'mode':r('mode'),'targetApps':{'type':'array','minItems':1,'maxItems':64,'items':r('app')},'capabilities':{'type':'array','uniqueItems':True,'maxItems':128,'items':{'type':'string','minLength':1,'maxLength':128}},'requestedLeaseMs':{'type':'integer','minimum':1,'maximum':86400000}},['mode','targetApps','capabilities'])
    defs['budget']=o({'wallMs':{'type':'integer','minimum':1,'maximum':86400000},'memoryMiB':{'type':'integer','minimum':1,'maximum':65536},'pendingCalls':{'type':'integer','minimum':1,'maximum':65536}},[])
    defs['source']={'oneOf':[o({'kind':{'const':'text'},'text':{'type':'string','maxLength':262144}}),o({'kind':{'const':'artifact'},'artifactId':r('id'),'sha256':r('hash')})]}
    params={
      'open':o({'apiRevision':r('revision'),'idempotencyKey':r('key'),'workspaceName':r('name'),'reuse':{'type':'boolean'},'control':r('controlRequest')},['apiRevision','idempotencyKey','workspaceName']),
      'exec':o({'apiRevision':r('revision'),'workspaceId':r('id'),'controlId':r('id'),'idempotencyKey':r('key'),'cellName':r('name'),'source':r('source'),'requestedBudget':r('budget')},['apiRevision','workspaceId','idempotencyKey','cellName','source']),
      'inspect':o({'apiRevision':r('revision'),'workspaceId':r('id'),'executionId':r('id'),'sinceSequence':r('counter'),'limit':{'type':'integer','minimum':1,'maximum':1000}},['apiRevision','workspaceId']),
      'respond':o({'apiRevision':r('revision'),'workspaceId':r('id'),'executionId':r('id'),'checkpointId':r('id'),'idempotencyKey':r('key'),'answer':r('json')}),
      'describe':o({'apiRevision':r('revision'),'subject':{'type':'string','minLength':1,'maxLength':256},'workspaceId':r('id')},['apiRevision','subject'])
    }
    defs['closeTarget']={'oneOf':[o({'kind':{'const':kind},field:r('id')}) for kind,field in [('execution','executionId'),('control','controlId'),('workspace','workspaceId')]]}
    params['close']=o({'apiRevision':r('revision'),'target':r('closeTarget')})
    for method,param in params.items():defs[method]=o({'method':{'const':method},'params':param})
    return {'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://cozea.invalid/aid-design/1.1/host.schema.json','title':'AID protocol-neutral host requests — design revision 1.1','description':'Application contract, not MCP. Schemas do not grant authority. Semantic/native checks enforce generation, byte and target rules.','oneOf':[r(x) for x in ['open','exec','inspect','respond','close','describe']],'$defs':defs}

def source_checks(d):
    text=(d/'29-research-register.md').read_text()
    urls=sorted(set(x.rstrip('.,;') for x in re.findall(r'https://[^\s<>]+',text)))
    def fetch(url):
        row={'url':url,'semanticReviewClaimedByFetch':False,'runtimeQualified':False}
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Cozea-AID-Design-Reference-Audit/1.1'})
            with urllib.request.urlopen(req,timeout=12) as response:
                data=response.read(4*1024*1024+1)
                if len(data)>4*1024*1024:raise ValueError('source response exceeds audit bound')
                row.update({'status':'retrieved','httpStatus':response.status,'finalUrl':response.url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
                raw=data.decode('utf8','replace')
                title=re.search(r'<title[^>]*>(.*?)</title>',raw,re.S|re.I)
                row['title']=re.sub(r'\s+',' ',title.group(1)).strip()[:240] if title else None
        except Exception as e:row.update({'status':'retrieval_failed','errorType':type(e).__name__})
        return row
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:rows=list(pool.map(fetch,urls))
    result={'date':'2026-09-08','purpose':'Primary-reference retrieval metadata; not a claim-by-claim semantic review or integration proof. No full copyrighted source pages are redistributed.','sources':rows,'retrieved':sum(x['status']=='retrieved' for x in rows),'failed':sum(x['status']!='retrieved' for x in rows),'adoptionRule':'Unqualified newer-platform claims are not required by the design; see D29 and G01–G12.'}
    jsonout(d/'research/source-checks.json',result)
    return result

def normalize_references(root,d):
    for i in range(1,13):
        p=d/'30-qualification-gates.md';s=p.read_text();heading=f'## G{i:02d} '
        marker=f'<a id="g{i:02d}"></a>'
        if marker not in s:s=s.replace(heading,marker+'\n'+heading)
        write(p,s)
    p=d/'28-implementation-roadmap.md';s=p.read_text()
    # Explicit stable anchors for the roadmap's shared W29/W30 and W33/W34 headings.
    for i in range(1,40):
        marker=f'<a id="w{i:02d}"></a>'
        if marker in s:continue
        exact=re.search(r'^### W'+f'{i:02d}'+r'\b.*$',s,re.M)
        if exact:s=s[:exact.start()]+marker+'\n'+s[exact.start():]
        else:
            group='### W29 / W30' if i==30 else '### W33 / W34' if i==34 else '### W36–W39' if i>=36 else None
            if group and group in s:s=s.replace(group,marker+'\n'+group,1)
            else:s+='\n'+marker+'\n'
    write(p,s)
    p=d/'02-contracts-sdk.md';s=p.read_text().replace('`artifact-export`, `supervisor`','`artifact-export`, `workspace-mutation`, `supervisor`');write(p,s)
    p=d/'31-design-reconciliation.md';s=p.read_text()
    if '## R18 — Documentation contract additions' not in s:
        s+='\n## R18 — Documentation contract additions\n\n`workspace-mutation` explicitly classifies opted-in local workspace data writes. It is not a native desktop effect or ambient filesystem access. Root `aid.observe` provides window/surface convenience calls; screen-wide or audio/hardware providers remain capability-qualified extensions. `PhysicalKey.code` is interpreted only under the qualified keyboard layout/key-code profile. No arbitrary native function names or raw pointers cross the guest boundary.\n\nAll six host method envelopes and their result variants are declared in the TypeScript contract. `host.schema.json` validates requests; `values.schema.json` validates shared/native values. The production generated result schemas and full per-native-method argument schemas must be emitted from the single production IDL in W02/W03, using these declarations and examples as the oracle. Do not treat an untyped native `arguments` object as permission to skip the method validator.\n'
        write(p,s)
    # Keep the original historical documents; add explicit successor/claim boundary.
    for name in ['computer-use-aid-environment-design.md','computer-use-programmable-aids.md','computer-use-current-platform-opportunities-2026-09.md']:
        p=root/'docs'/name
        if not p.exists():continue
        s=p.read_text();marker='> Current implementation handoff:'
        if marker not in s:
            s=s.split('\n',1)[0]+'\n\n'+marker+' [AID master revision 1.1](aid-system/MASTER.md), [shared reconciliation](aid-system/31-design-reconciliation.md), and [primary evidence/adoption boundaries](aid-system/29-research-register.md) supersede this earlier proposal for implementation. Specific newer-protocol/runtime claims here are not universal prerequisites; retain negotiated compatibility and qualification gates.\n\n'+s.split('\n',1)[1]
            write(p,s)
    # Preserve earlier continuity and append an unambiguous newest entry.
    p=root/'.agent/CONTINUITY.md'
    old=p.read_text() if p.exists() else '# Continuity\n'
    marker='## 2026-09-08 — Completed AID design handoff revision 1.1'
    if marker not in old:
        new='\n'+marker+'\n\nRead `docs/aid-system/MASTER.md`, `31-design-reconciliation.md`, `28-implementation-roadmap.md`, `30-qualification-gates.md`, then owning subsystem files and `contracts/README.md`. The original 27 subsystem designs are preserved; missing roadmap/register/gates/contracts were newly completed, not claimed recovered. Named module cells, explicit exports, identity/authority lifetimes, typed coordinates, owner-scoped capture, resume-once checkpoints and truthful receipts remain core. Do not adopt a claimed newer MCP/WASI/Swift feature without its actual profile/gate. Native/runtime/provider/performance gates remain unrun. Documentation checks and exact artifact hashes are recorded in `docs/aid-system/design-validation.json` and `DESIGN-MANIFEST.json`. No runtime implementation, main merge or release belongs to this task. Implementation begins with W01/W02 and parallel G01/G02 spikes.\n'
        write(p,old.split('\n',1)[0]+'\n'+new+'\n'+(old.split('\n',1)[1] if '\n' in old else ''))
    p=root/'AGENTS.md'
    if p.exists():
        s=p.read_text();needle='Read `docs/computer-use-v2.md` before changing Computer Use input, observations, cursor, policy, packaging, or release validation.'
        if needle in s:
            s=s.replace(needle,'Read `docs/aid-system/MASTER.md` and its revisioned contracts before new AID work. `docs/computer-use-v2.md` describes the historical runtime baseline; follow the master\'s research and qualification boundaries for input, observations, cursor, policy, packaging and release validation.')
            write(p,s)
    index='# Programmable AID design index\n\nThe implementation handoff is [docs/aid-system/MASTER.md](aid-system/MASTER.md). Read [HANDOFF](aid-system/HANDOFF.md) for validation and the documentation/runtime boundary.\n\n'
    for p in sorted(d.glob('*.md')):index+=f'- [{p.name}](aid-system/{p.name})\n'
    index+='\n[Shared contracts](aid-system/contracts/README.md) and the machine-readable validation/manifest accompany the corpus. The older publication record documents the earlier 28-file recovery; it is not a runtime qualification report.\n'
    write(root/'docs/computer-use-aid-design-index.md',index)


def exports(root,d,out):
    out.mkdir(parents=True,exist_ok=True)
    files=[p for p in d.rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    for name in ['computer-use-aid-environment-design.md','computer-use-programmable-aids.md','computer-use-current-platform-opportunities-2026-09.md','computer-use-v2.md','computer-use-aid-design-implementation-clarifications.md','computer-use-aid-design-index.md','computer-use-aid-design-work-log.md','computer-use-aid-design-publication.json']:
        p=root/'docs'/name
        if p.exists():files.append(p)
    for p in [root/'.agent/CONTINUITY.md',root/'AGENTS.md']:
        if p.exists():files.append(p)
    files=sorted(set(files));assert len(files)>40,'Refuse an empty or abbreviated export'
    export_manifest={'contractRevision':F.REVISION,'files':[{'path':str(p.relative_to(root)),'sha256':F.sha(p.read_bytes()),'bytes':p.stat().st_size} for p in files],'nativeQualification':'not_run'}
    zpath=out/'Cozea-AID-System-Design-v1.1.zip'
    with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files:z.write(p,str(p.relative_to(root)))
        z.writestr('EXPORT-MANIFEST.json',F.dump(export_manifest))
    with zipfile.ZipFile(zpath) as z:
        assert z.testzip() is None
        for row in export_manifest['files']:assert F.sha(z.read(row['path']))==row['sha256'],row['path']
    ordered=[d/'MASTER.md',d/'31-design-reconciliation.md']+[p for p in sorted(d.glob('[0-9][0-9]-*.md')) if p.name!='31-design-reconciliation.md']
    combined='# Cozea programmable AID system — consolidated design revision 1.1\n\nThis edition contains the actual complete numbered documentation corpus, not the earlier empty recovery placeholder. Individual relative links are best followed in the archive or repository. Contracts and validation scripts are supplied in the archive. Native/platform qualification is not claimed.\n'
    for p in ordered:
        text=p.read_text();assert len(text)>1000,p
        combined+='\n\n---\n\nSource: `'+str(p.relative_to(root))+'`\n\n'+text
    write(out/'Cozea-AID-Master-Design-v1.1.md',combined)
    report=json.loads((d/'design-validation.json').read_text());assert report['allDesignChecksPassed'] is True
    words=len(combined.split())
    summary='# AID design handoff validation\n\nThis is documentation/contract validation, not a native runtime test.\n\n'
    summary+=f'Numbered subsystem/design documents: {len(ordered)-1}. Consolidated words: {words}. Export entries: {len(export_manifest["files"])}.\n\n'
    summary+='| Check | Result |\n|---|---|\n'
    for check in report['checks']:summary+='| '+check['check']+' | '+check['status']+' |\n'
    summary+='\nThe export archive was reopened, its CRCs checked, and every payload SHA-256 compared with the source manifest. Source retrieval metadata is not represented as semantic verification. G01–G12 remain unrun; actual input, TCC, sandbox, provider compatibility and performance require implementation qualification.\n'
    write(out/'Cozea-AID-Design-Validation-v1.1.md',summary)
    jsonout(out/'Cozea-AID-Export-Manifest-v1.1.json',export_manifest)
    return {'zip':str(zpath),'files':len(export_manifest['files']),'consolidatedWords':words,'sha256':F.sha(zpath.read_bytes())}


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--write',action='store_true');p.add_argument('--check',action='store_true');p.add_argument('--research',action='store_true');p.add_argument('--export-dir');a=p.parse_args()
    root=Path(a.root).resolve();d=root/'docs/aid-system';assert d.is_dir()
    if a.write:
        jsonout(d/'contracts/host.schema.json',host_schema())
        normalize_references(root,d)
        if a.research:source_checks(d)
    elif json.loads((d/'contracts/host.schema.json').read_text())!=host_schema():raise SystemExit('Host schema drift; use the explicit documentation generation step.')
    cmd=[sys.executable,str(HERE/'finalize_design.py'),'--root',str(root),'--write' if a.write else '--check']
    if not a.write:cmd+=['--report',str(Path(tempfile_path())/'aid-design-readonly-check.json')]
    done=subprocess.run(cmd,timeout=240)
    if done.returncode:return done.returncode
    if a.write:
        log=root/'docs/computer-use-aid-design-work-log.md';old=log.read_text() if log.exists() else '# AID design work log\n'
        marker='## Revision 1.1 completion and checked export'
        if marker not in old:
            write(log,old+'\n'+marker+'\n\nThe missing roadmap, named primary-source register, G01–G12 gate procedures, SDK declaration and shared schema/example/state artifacts were completed from the preserved corpus. Source references/read order were reconciled without treating unverified newer-platform claims as dependencies. The documentation validator passed the checks recorded in `docs/aid-system/design-validation.json`; this is not native/runtime qualification. The versioned export is generated only after validation, contains the actual corpus, and verifies every archived payload against source hashes. The original empty recovery exports are superseded, not re-described as successful. No runtime implementation or release is included.\n')
    if a.export_dir:print(F.dump(exports(root,d,Path(a.export_dir).resolve())))
    return 0

def tempfile_path():
    import tempfile
    return tempfile.gettempdir()
if __name__=='__main__':raise SystemExit(main())
