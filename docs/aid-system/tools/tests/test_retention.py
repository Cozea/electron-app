"""Bounded reference model: replay index is distinct from cached responses."""
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
