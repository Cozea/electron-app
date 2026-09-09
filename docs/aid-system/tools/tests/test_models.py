"""Reference-model tests: these do NOT test macOS or the production runtime."""
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
 def __init__(self,dep):self.dep=dep;self.answer=None;self.claimed=False;self.settlements=0;self.result=None
 def respond(self,answer,current):
  if self.claimed:
   if self.answer!=answer:raise Conflict()
   return self.result
  self.answer=answer;self.claimed=True;self.settlements+=1
  self.result='dependency-changed' if current!=self.dep else 'resumed'
  return self.result
class Capture:
 def __init__(self):self.next=0;self.current=None;self.stopped=[]
 def acquire(self,owner):
  if self.current and self.current['state'] in ('starting','warm'):
   self.current['owners'].add(owner);self.current['borrows']+=1;return self.current
  self.next+=1;entry={'generation':self.next,'state':'starting','startPending':True,'owners':{owner},'borrows':1};self.current=entry;return entry
 def release_owner(self,entry,owner):
  entry['owners'].discard(owner)
  if not entry['owners']:entry['state']='retiring';self.finish(entry)
 def release_borrow(self,entry):entry['borrows']-=1;self.finish(entry)
 def finish(self,entry):
  if entry['state']=='retiring' and not entry['borrows'] and not entry['startPending']:
   entry['state']='stopped';self.stopped.append(entry['generation'])
   if self.current is entry:self.current=None
 def complete_start(self,entry):
  entry['startPending']=False
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
  x=Capture();e=x.acquire('a');x.complete_start(e);x.release_owner(e,'a');self.assertEqual(e['state'],'retiring');x.release_borrow(e);self.assertEqual(e['state'],'stopped')
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
class AddedBoundaryTests(unittest.TestCase):
 def test_pending_start_outlives_last_borrow(self):
  x=Capture();old=x.acquire('a');x.release_owner(old,'a');x.release_borrow(old)
  self.assertEqual(old['state'],'retiring');self.assertEqual(x.stopped,[])
  new=x.acquire('b');x.complete_start(old);x.complete_start(new)
  self.assertEqual(x.stopped,[old['generation']]);self.assertIs(x.current,new)

 def test_json_null_answer_resumes_once(self):
  x=Checkpoint('a');x.respond(None,'a');x.respond(None,'a');self.assertEqual(x.settlements,1)
 def test_null_answer_conflicts_with_later_value(self):
  x=Checkpoint('a');x.respond(None,'a')
  with self.assertRaises(Conflict):x.respond('yes','a')
if __name__=='__main__':unittest.main()
