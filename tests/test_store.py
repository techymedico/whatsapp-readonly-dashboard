import unittest,tempfile
from server.store import Store
from server.normalize import normalize

def event(i='m1',**kw):
 return dict(id='event:'+i,message_id=i,type='message',phone='15550001001',direction='in',timestamp='2026-01-01T12:00:00+00:00',text='Hello',students=['Example One','Example Two'],**kw)
class StorageTests(unittest.TestCase):
 def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.path=self.tmp.name+'/test.db'; self.s=Store(self.path)
 def tearDown(self): self.s.db.close();self.tmp.cleanup()
 def test_duplicate_replay(self):
  self.s.apply([event(),event()],1);self.s.apply([event()],1);self.assertEqual(self.s.stats()['messages'],1)
 def test_restart_checkpoint(self):
  self.s.apply([event()],8);self.s.db.close();self.s=Store(self.path);self.assertEqual(self.s.cursor(),8);self.assertEqual(len(self.s.messages('15550001001')),1)
 def test_batch_rollback(self):
  with self.assertRaises(ValueError): self.s.apply([event(),{'id':'bad'}],5)
  self.assertEqual(self.s.cursor(),0);self.assertEqual(self.s.stats()['messages'],0)
 def test_status_before_message_and_no_regression(self):
  self.s.apply([dict(id='s1',type='status',message_id='m1',status='read'),event(),dict(id='s2',type='status',message_id='m1',status='sent')],3)
  self.assertEqual(self.s.messages('15550001001')[0]['status'],'read')
 def test_shared_parent_search(self):
  self.s.apply([event()],1);self.assertEqual(len(self.s.conversations('Example Two')),1)
 def test_unread_is_local(self):
  self.s.apply([event()],1);self.assertEqual(self.s.stats()['unread'],1);self.s.seen('15550001001');self.assertEqual(self.s.stats()['unread'],0)
 def test_checkpoint_never_backwards(self):
  self.s.apply([event()],5)
  with self.assertRaises(ValueError):self.s.apply([event('m2')],4)
  self.assertEqual(self.s.stats()['messages'],1)
 def test_invalid_phone(self):
  e=event();e['phone']='bad'
  with self.assertRaises(ValueError):self.s.apply([e],1)
 def test_normalize(self):
  p={'object':'whatsapp_business_account','entry':[{'changes':[{'field':'messages','value':{'messages':[{'id':'x','from':'15550001001','type':'text','text':{'body':'Hello'},'timestamp':'1767268800'}],'statuses':[{'id':'y','status':'delivered'}]}}]}]}
  self.assertEqual(len(normalize(p)),2)
if __name__=='__main__':unittest.main()

class MediaTests(unittest.TestCase):
 def setUp(self): self.tmp=tempfile.TemporaryDirectory(); self.path=self.tmp.name+'/test.db'; self.s=Store(self.path)
 def tearDown(self): self.s.db.close();self.tmp.cleanup()
 def test_media_validation(self):
  import base64
  with tempfile.TemporaryDirectory() as d:
   s=Store(d+'/db');blob=base64.b64encode(b'%PDF-1.4\n test').decode()
   s.apply([{'id':'media1','message_id':'m','type':'media','reference':'r1','mime':'application/pdf','base64':blob}],1)
   self.assertEqual(s.media('r1')['mime'],'application/pdf')
   with self.assertRaises(ValueError):s.apply([{'id':'bad','message_id':'m','type':'media','reference':'x','mime':'text/html','base64':blob}],2)
   s.db.close()
 def test_binary_download_retry_integrity_and_restart(self):
  import hashlib
  content=b'%PDF-test'
  e=dict(id='media:ref',type='media_ref',message_id='m',reference='ref',mime='application/pdf',size=len(content),sha256=hashlib.sha256(content).hexdigest())
  self.s.apply([e],1)
  with self.assertRaises(ValueError):self.s.complete_media(e,b'bad')
  self.assertEqual(len(self.s.pending_media()),1)
  self.s.db.close();self.s=Store(self.path)
  self.s.complete_media(e,content)
  self.assertEqual(self.s.pending_media(),[])
  self.assertEqual(self.s.media('ref')['bytes'],content)
