#!/usr/bin/env python3
"""Generate, check, and export the documentation contract. Never operates a desktop.

Generation is explicit. Check/export never repair or rewrite repository files.
Dependencies: Python 3.12, jsonschema 4.23.0, Bun 1.2.22, TypeScript 5.6.3.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, re, subprocess, sys, tempfile, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
D=ROOT/'docs/aid-system'; C=D/'contracts'
def dump(v):return json.dumps(v,indent=2,ensure_ascii=False,allow_nan=False)+'\n'
def sha(b):return hashlib.sha256(b).hexdigest()
def run(args,**kwargs):return subprocess.check_output(args,cwd=ROOT,text=True,stderr=subprocess.STDOUT,**kwargs)
def source():
    s=json.loads((C/'contract-source.json').read_text())
    s['schemas']={name:{**root['schema'],**({'$defs':{k:s['definitions'][k] for k in root['definitionNames']}} if root['definitionNames'] else {})} for name,root in s['schemaRoots'].items()}
    return s
def typename(n):return 'Wire'+n[0].upper()+n[1:]
def ts(s):
    if '$ref' in s:return typename(s['$ref'].split('/')[-1])
    if 'const' in s:return json.dumps(s['const'])
    if 'enum' in s:return ' | '.join(json.dumps(v) for v in s['enum'])
    for key,join in [('oneOf',' | '),('anyOf',' | ')]:
        if key in s:return join.join('('+ts(v)+')' for v in s[key])
    if 'allOf' in s and 'type' not in s:
        # Refinement-only clauses constrain runtime validation, not TS structure.
        return ' & '.join('('+ts(v)+')' for v in s['allOf'] if '$ref'in v or 'type'in v) or 'JsonValue'
    typ=s.get('type')
    if isinstance(typ,list):return ' | '.join(ts({**s,'type':x}) for x in typ)
    if typ in ('number','integer'):return 'number'
    if typ in ('string','boolean','null'):return typ
    if typ=='array':return 'ReadonlyArray<'+ts(s.get('items',{}))+'>'
    if typ=='object' or 'properties'in s:
        props=s.get('properties',{}); required=s.get('required',[])
        body=['readonly '+json.dumps(k)+('' if k in required else '?')+': '+ts(v)+';' for k,v in props.items()]
        extra=s.get('additionalProperties',True)
        if extra is not False:body.append('readonly [key: string]: '+(ts(extra) if isinstance(extra,dict) else 'JsonValue')+';')
        return '{ '+' '.join(body)+' }'
    return 'JsonValue'
def outputs(s):
    out={}; schemas=s['schemas']; defs={}
    contract_hash=sha((C/'contract-source.json').read_bytes())
    for name,schema in schemas.items():
        out[f'{name}.schema.json']=dump({**schema,'x-contract-sha256':contract_hash,'x-generator':'design.py/1.1'})
        if name=='qualification':continue
        for key,value in schema['$defs'].items():
            if key in defs and defs[key]!=value:raise ValueError('Conflicting shared definition: '+key)
            defs[key]=value
    wire='\n// Generated wire values. Refinements (bounds, oneOf exclusivity, quiescence,\n// evidence alignment) additionally require the JSON/semantic validator.\n'
    for name,schema in defs.items():wire+='export type '+typename(name)+' = '+ts(schema)+';\n'
    wire+='export type HostRequest = '+ts(schemas['host'])+';\nexport type HostResult = '+ts(schemas['results'])+';\n'
    wire+='export interface HostApi {\n'
    kinds={'open':'opened','exec':'execution','inspect':'inspection','respond':'execution','close':'closing','describe':'described'}
    for method,kind in kinds.items():wire+=f'  {method}(params: {typename(method)}["params"]): Promise<{typename(kind)} | WireError>;\n'
    wire+='}\n'
    out['aid-sdk.d.ts']='// GENERATED from contract-source.json; run tools/design.py generate.\n// Contract SHA256: '+contract_hash+'; generator design.py/1.1\n'+s['guestDeclarations']+wire
    # Same bytes, explicitly a compatibility filename, never a second vocabulary.
    out['aid-wire.schema.json']=out['host.schema.json']
    out['state-machines.json']=dump(s['machines'])
    bynum={int(p.name[:2]):p.name for p in D.glob('[0-9][0-9]-*.md') if p.name!='31-cross-system-review.md'}
    out['work-packages.json']=dump({'revision':s['revision'],'packages':[{**w,'documents':[bynum[n] for n in w['documents']],'state':'not-started'} for w in s['workPackages']]})
    out['qualification-status.json']=dump({'revision':s['revision'],'runtimeImplemented':False,'profile':'macOS26-apple-silicon-initial','gates':[{'id':k,'title':v,'status':'not_run','evidence':[]} for k,v in s['gates'].items()]})
    out['method-catalogue.json']=dump({'revision':s['revision'],'methods':s.get('methods',[]),'note':'Guest methods and host operations have separate namespaces. Callback/resource/RegExp codecs are prescribed in D02. Capability lists are minima; native checks bind owner, epoch, route and target.'})
    rows=[]
    for n in range(1,28):
        p=D/bynum[n]
        ids=sorted(set(re.findall(r'\b[A-Z][A-Z0-9]+-\d{2,3}\b',p.read_text())))
        rows.append({'document':p.name,'requirements':ids,'workPackages':[w['id'] for w in s['workPackages'] if n in w['documents']],'gates':s['gatesByDocument'][str(n)],'contract':'aid-sdk.d.ts','acceptanceSection':p.name})
    out['traceability.json']=dump({'revision':s['revision'],'subsystems':rows,'note':'Requirement IDs are linked to their owning document acceptance section; runtime tests are prescribed there and in D30, not claimed executed.'})
    requirements=[]
    for row in rows:
        text=(D/row['document']).read_text()
        for match in re.finditer(r'\*\*([A-Z][A-Z0-9]+-\d{2,3}):\*\*\s*(.*?)(?=\*\*[A-Z][A-Z0-9]+-\d{2,3}:\*\*|\n\n|\Z)',text,re.S):
            rid,criterion=match.groups()
            requirements.append({'id':rid,'owner':row['document'],'criterion':criterion.strip(),
                'workPackages':row['workPackages'],'contractTypes':s['contractTypesByDocument'][row['document'][:2]],
                'implementationTestId':rid,'implementationTestStatus':'not_run','qualificationGates':row['gates'],
                'designEvidence':'../DESIGN-REVIEW.md','note':'The named acceptance case is prescribed; document checks do not substitute for this implementation test.'})
    out['requirement-traceability.json']=dump({'revision':s['revision'],'requirements':requirements})
    out['invariant-traceability.json']=dump({'revision':s['revision'],'invariants':s['invariantTraceability']})
    return out
def semantic(v):
    """Cross-field checks applied recursively, including receipts inside results."""
    if len(dump(v).encode())>1024*1024:raise ValueError('control message exceeds byte limit')
    def walk(x,key='',depth=0):
        if depth>64:raise ValueError('JSON nesting limit')
        if isinstance(x,float) and (not math.isfinite(x) or x==0 and math.copysign(1,x)<0):raise ValueError('noncanonical number')
        if isinstance(x,str) and (key in ('sequence','sinceSequence','controlEpoch','epoch','generation','transformGeneration','captureGeneration') or key.endswith('MonotonicNs')):
            if not re.fullmatch(r'0|[1-9][0-9]*',x) or int(x)>2**64-1:raise ValueError('UInt64 range')
        if isinstance(x,dict):
            if x.get('outcome') in ('verified','failed'):
                declared=set(x.get('evidenceIds',[]));used=set(x.get('verification',{}).get('evidenceIds',[]))
                if not used or not used<=declared:raise ValueError('verification evidence mismatch')
                if x.get('evidence')=='not_checked':raise ValueError('verified/failed outcome without checked evidence')
            if 'checkpoint'in x and x.get('executionId')!=x['checkpoint'].get('executionId'):raise ValueError('checkpoint execution mismatch')
            if 'lastReceipt'in x and x.get('executionId')!=x['lastReceipt'].get('executionId'):raise ValueError('receipt execution mismatch')
            for k,val in x.items():walk(val,k,depth+1)
        elif isinstance(x,list):
            for val in x:walk(val,key,depth+1)
    walk(v)
def strict_load(text):
    def pairs(p):
        d={}
        for k,v in p:
            if k in d:raise ValueError('duplicate JSON key: '+k)
            d[k]=v
        return d
    return json.loads(text,object_pairs_hook=pairs,parse_constant=lambda x:(_ for _ in ()).throw(ValueError(x)))
def anchors(text):
    result=set(re.findall(r'<a\s+id=["\']([^"\']+)["\']',text));seen={}
    for heading in re.findall(r'^#{1,6}\s+(.+)$',text,re.M):
        heading=re.sub(r'\[([^\]]+)\]\([^)]*\)',r'\1',heading)
        slug=re.sub(r'[^\w\s-]','',heading.lower());slug=re.sub(r'\s','-',slug.strip())
        n=seen.get(slug,0);seen[slug]=n+1;result.add(slug if not n else slug+'-'+str(n))
    return result
def tracked_inputs():
    paths=set(run(['git','ls-files','--','docs/aid-system','docs/computer-use-aid*','.agent/CONTINUITY.md','.github/workflows/aid-*']).splitlines())
    paths.update(str(p.relative_to(ROOT)) for p in D.rglob('*') if p.is_file() and '__pycache__'not in str(p))
    return sorted(p for p in paths if (ROOT/p).is_file() and '__pycache__'not in p)
def hashes():return {p:sha((ROOT/p).read_bytes()) for p in tracked_inputs()}
def check():
    before=hashes();s=source();checks=[]
    def test(name,fn):
        try:detail=fn();checks.append({'name':name,'status':'passed','detail':detail});print('PASS',name,flush=True)
        except Exception as e:checks.append({'name':name,'status':'failed','detail':(e.output if isinstance(e,subprocess.CalledProcessError) else str(e))});print('FAIL',name,(e.output if isinstance(e,subprocess.CalledProcessError) else str(e))[:5000],flush=True)
    def generated():
        bad=[name for name,data in outputs(s).items() if not (C/name).exists() or (C/name).read_text()!=data]
        if bad:raise ValueError('Generated drift: '+', '.join(bad))
        return f'{len(outputs(s))} deterministic artifacts; shared definitions identical'
    def links():
        bad=[];count=0
        for p in list(D.rglob('*.md'))+[ROOT/'docs/computer-use-aid-design-index.md']:
            text=re.sub(r'```.*?```','',p.read_text(),flags=re.S)
            for target in re.findall(r'(?<!!)\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)',text):
                if re.match(r'^[a-z]+:',target) or target.startswith('//'):continue
                path,_,anchor=target.partition('#');dest=(p.parent/path).resolve() if path else p
                count+=1
                if not dest.is_file() or anchor and dest.suffix=='.md' and anchor not in anchors(dest.read_text()):bad.append(f'{p.relative_to(ROOT)} -> {target}')
        if bad:raise ValueError('\n'.join(bad))
        return f'{count} local links and anchors checked'
    def graphs():
        deps={w['id']:w['dependsOn'] for w in s['workPackages']};seen=set();active=set()
        def visit(x):
            if x in active:raise ValueError('dependency cycle: '+x)
            if x not in deps:raise ValueError('unknown dependency: '+x)
            if x in seen:return
            active.add(x)
            for d in deps[x]:visit(d)
            active.remove(x);seen.add(x)
        for x in deps:visit(x)
        road=(D/'28-implementation-roadmap.md').read_text()
        for w in s['workPackages']:
            pattern=r'^#{2,4}[^\n]*\b'+w['id']+r'\b.*?(?=^#{2,4} |\Z)'
            match=re.search(pattern,road,re.M|re.S)
            if not match and w['id'].startswith('X'):
                row=re.search(r'^\| '+w['id']+r'[^\n]*',road,re.M)
                actual=re.findall(r'\bW\d{2}\b',row.group()) if row else []
                if sorted(actual)!=sorted(w['dependsOn']):raise ValueError('extension dependencies '+w['id'])
                continue
            if not match:raise ValueError('missing roadmap package '+w['id'])
            section=match.group();dm=re.search(r'\*\*Dependencies:\*\*([^\n]*)',section)
            actual=re.findall(r'\b[WX]\d{2}\b',dm.group(1)) if dm else []
            if sorted(actual)!=sorted(w['dependsOn']):raise ValueError(w['id']+' prose dependencies '+str(actual)+' != '+str(w['dependsOn']))
        for name,m in s['machines'].items():
            if not isinstance(m,dict) or 'transitions'not in m:continue
            edges=m['transitions'];reachable=set();stack=[m['initial']]
            while stack:
                x=stack.pop()
                if x not in edges:raise ValueError(name+' unknown state '+x)
                if x in reachable:continue
                reachable.add(x);stack.extend(edges[x])
            if reachable!=set(edges):raise ValueError(name+' unreachable states')
            if any(edges[x] for x in m['terminal']):raise ValueError(name+' terminal has outgoing transition')
        return f'{len(deps)} packages match D28; four state graphs reachable and closed'
    def schemas():
        from jsonschema import Draft202012Validator, ValidationError
        validators={k:Draft202012Validator(v) for k,v in s['schemas'].items()}
        for v in s['schemas'].values():Draft202012Validator.check_schema(v)
        rows=json.loads((C/'conformance-vectors.json').read_text())['tests'];ids=set()
        for row in rows:
            if row['id']in ids:raise ValueError('duplicate vector id '+row['id'])
            ids.add(row['id']);ok=True
            try:validators[row['schema']].validate(row['value']);semantic(row['value'])
            except (ValueError,ValidationError) as e:
                ok=False;error=str(e)
            if ok!=row['valid']:raise ValueError(row['id']+': expected '+str(row['valid'])+', '+('accepted'if ok else error))
        for raw in ['{"a":1,"a":2}','{"x":NaN}','{"x":Infinity}']:
            try:strict_load(raw)
            except ValueError:continue
            raise ValueError('accepted noncanonical JSON')
        return f'{len(rows)} positive/negative vectors; duplicate keys and nonfinite numbers rejected'
    def models():return run([sys.executable,'-B','-m','unittest','discover','-s',str(D/'tools/tests'),'-p','test_*.py','-v'])
    def types():
        bun=os.environ.get('AID_BUN','bun');tsroot=os.environ.get('AID_TYPESCRIPT_ROOT',str(ROOT/'node_modules/typescript'))
        out=run([bun,str(Path(tsroot)/'bin/tsc'),'--project',str(C/'tsconfig.json'),'--pretty','false'])
        actual=json.loads(run([bun,str(D/'tools/methods.cjs'),str(C/'aid-sdk.d.ts')]))
        wanted=[{k:m[k] for k in ('name','parameters','returns')} for m in s['methods']]
        if actual!=wanted:raise ValueError('AST method catalogue drift')
        out+=run([bun,str(C/'examples/geometry-test.mjs')])
        return f'{len(actual)} guest signatures match catalogue; positive/negative TypeScript examples and pure module reuse pass. '+out
    def inventory():
        for n in range(1,32):
            ps=[p for p in D.glob(f'{n:02d}-*.md') if p.name!='31-cross-system-review.md']
            if len(ps)!=1 or ps[0].stat().st_size<1000:raise ValueError('missing/substitute D'+str(n))
        for name in ('MASTER.md','HANDOFF.md','DESIGN-REVIEW.md'):
            if not (D/name).is_file():raise ValueError('missing '+name)
        rows=json.loads((C/'traceability.json').read_text())['subsystems']
        if len(rows)!=27 or any(not x['workPackages'] or not x['gates'] for x in rows):raise ValueError('unmapped subsystem')
        cases=json.loads((C/'requirement-traceability.json').read_text())['requirements']
        for row in rows:
            owned=set(re.findall(r'\*\*([A-Z][A-Z0-9]+-\d{2,3}):\*\*',(D/row['document']).read_text()))
            mapped={c['id'] for c in cases if c['owner']==row['document']}
            if owned!=mapped:raise ValueError('unmapped requirement in '+row['document'])
        declared=(C/'aid-sdk.d.ts').read_text()
        for case in cases:
            for typ in case['contractTypes']:
                if not re.search(r'export (?:interface|type) '+typ+r'\b',declared):raise ValueError('missing contract type '+typ)
        ids={c['id'] for c in cases}
        invariants=json.loads((C/'invariant-traceability.json').read_text())['invariants']
        master_ids=set(re.findall(r'\| (INV-\d{2}) \|',(D/'MASTER.md').read_text()))
        if {i['id'] for i in invariants}!=master_ids:raise ValueError('unmapped master invariant')
        for inv in invariants:
            if not set(inv['acceptanceTests'])<=ids:raise ValueError('unknown invariant acceptance case '+str(set(inv['acceptanceTests'])-ids))
        return f'31 owning designs, 27 subsystem mappings, {len(cases)} named acceptance requirements; all 12 implementation gates unrun'
    for name,fn in [('generated-contract-drift',generated),('local-links-and-anchors',links),('roadmap-and-state-graphs',graphs),('schemas-and-semantic-vectors',schemas),('reference-models-and-retention',models),('typescript-and-method-coverage',types),('deliverable-and-traceability-inventory',inventory)]:test(name,fn)
    test('validation-is-read-only',lambda: 'source bytes unchanged' if before==hashes() else (_ for _ in()).throw(ValueError('check mutated inputs')))
    return {'sourceCommit':run(['git','rev-parse','HEAD']).strip(),'sourceFiles':before,'sourceDigest':sha(dump(before).encode()),'workingTree':run(['git','status','--porcelain']).splitlines(),'checks':checks,'passed':all(x['status']=='passed' for x in checks),'runtimeQualification':'not_run'}
def export(out,report):
    if not report['passed']:raise ValueError('export requires all checks passing')
    if run(['git','status','--porcelain']).strip():raise ValueError('export requires a clean committed checkout')
    out=out.resolve()
    if out.is_relative_to(ROOT):raise ValueError('export must be outside repository')
    out.mkdir(parents=True,exist_ok=True);files=report['sourceFiles']
    for p,digest in files.items():
        committed=subprocess.check_output(['git','show',report['sourceCommit']+':'+p],cwd=ROOT)
        if sha(committed)!=digest:raise ValueError('working bytes differ from committed source: '+p)
    selected=['docs/aid-system/MASTER.md']+[f'docs/aid-system/{p.name}' for p in sorted(D.glob('[0-9][0-9]-*.md')) if p.name!='31-cross-system-review.md']+['docs/aid-system/DESIGN-REVIEW.md','docs/aid-system/HANDOFF.md']
    edition='# Cozea AID system design — reading edition\n\nSource commit: `'+report['sourceCommit']+'`. The archive preserves working relative links and contracts. Runtime qualification is not run.\n\n'
    for p in selected:edition+='\n\n---\n\n<!-- Source: '+p+'; sha256: '+files[p]+' -->\n\n'+(ROOT/p).read_text()
    (out/'Cozea-AID-Master-Design.md').write_text(edition)
    (out/'Cozea-AID-Validation.json').write_text(dump(report))
    manifest={'sourceCommit':report['sourceCommit'],'sourceFiles':files,'readingEditionSha256':sha(edition.encode()),'validationSha256':sha(dump(report).encode())}
    archive=out/'Cozea-AID-System-Design.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in files:z.writestr(p,(ROOT/p).read_bytes())
        z.writestr('MANIFEST.json',dump(manifest));z.writestr('VALIDATION.json',dump(report));z.writestr('Cozea-AID-Master-Design.md',edition)
    with zipfile.ZipFile(archive) as z:
        if z.testzip():raise ValueError('zip CRC failure')
        for p,digest in files.items():
            if sha(z.read(p))!=digest:raise ValueError('export mismatch: '+p)
        if z.read('Cozea-AID-Master-Design.md').decode()!=edition:raise ValueError('edition mismatch')
    if (out/'Cozea-AID-Master-Design.md').read_text()!=edition:raise ValueError('reading edition write mismatch')
    print(dump({'exportedSourceFiles':len(files),'commit':report['sourceCommit'],'archive':str(archive),'zipSha256':sha(archive.read_bytes())}))
def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['generate','check','export']);p.add_argument('--report',type=Path);p.add_argument('--out',type=Path);a=p.parse_args()
    if a.command=='generate':
        for name,text in outputs(source()).items():(C/name).write_text(text)
        print('Generated contract artifacts only; source documents and fixtures untouched.');return
    report=check()
    if a.report:
        if a.report.resolve().is_relative_to(ROOT):raise ValueError('reports must be outside source checkout')
        a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(dump(report))
    if not report['passed']:sys.exit(1)
    if a.command=='export':
        if not a.out:p.error('--out is required for export')
        export(a.out,report)
if __name__=='__main__':main()
