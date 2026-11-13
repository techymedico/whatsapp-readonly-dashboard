import sqlite3,json,re,base64,hashlib
from datetime import datetime
RANK={'pending':0,'accepted':1,'sent':2,'failed':2,'delivered':3,'read':4}
class Store:
 def __init__(self,path):
  self.db=sqlite3.connect(path,check_same_thread=False)
  self.db.row_factory=sqlite3.Row
  self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, mime TEXT, filename TEXT, bytes BLOB);
CREATE TABLE IF NOT EXISTS media_jobs(reference TEXT PRIMARY KEY, event TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, phone TEXT, direction TEXT, text TEXT, kind TEXT, timestamp TEXT, status TEXT, name TEXT, students TEXT, media TEXT, seen INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS messages_phone_time ON messages(phone,timestamp,id);
CREATE TABLE IF NOT EXISTS statuses(id TEXT PRIMARY KEY,status TEXT);
CREATE TABLE IF NOT EXISTS checkpoints(id INTEGER PRIMARY KEY,cursor INTEGER);
INSERT OR IGNORE INTO checkpoints VALUES(1,0);''')
 def apply(self,events,cursor):
  with self.db:
   for e in events:
    if not isinstance(e.get('id'),str) or len(e['id'])>256: raise ValueError('Invalid event id')
    if self.db.execute('SELECT 1 FROM events WHERE id=?',(e['id'],)).fetchone(): continue
    mid=e.get('message_id'); typ=e.get('type')
    if not isinstance(mid,str) or not mid or len(mid)>256: raise ValueError('Invalid message id')
    if typ=='media_ref':
     if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,256}',e.get('reference','')) or not re.fullmatch(r'[a-f0-9]{64}',e.get('sha256','')) or not isinstance(e.get('size'),int) or not 0<e['size']<=10_000_000 or e.get('mime') not in ('image/png','image/jpeg','application/pdf'): raise ValueError('Invalid media descriptor')
     self.db.execute('INSERT OR IGNORE INTO media_jobs VALUES(?,?)',(e['reference'],json.dumps(e)))
    elif typ=='media':
     content=base64.b64decode(e.get('base64',''),validate=True)
     mime=e.get('mime'); signatures={'image/png':b'\x89PNG\r\n\x1a\n','image/jpeg':b'\xff\xd8\xff','application/pdf':b'%PDF-'}
     if mime not in signatures or not content.startswith(signatures[mime]) or len(content)>10_000_000: raise ValueError('Invalid media')
     reference=e.get('reference','')
     if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,256}',reference): raise ValueError('Invalid media id')
     self.db.execute('INSERT OR IGNORE INTO media VALUES(?,?,?,?)',(reference,mime,str(e.get('filename','attachment'))[:200],content))
    elif typ=='status':
     status=e.get('status')
     if status not in RANK: raise ValueError('Invalid status')
     old=self.db.execute('SELECT status FROM statuses WHERE id=?',(mid,)).fetchone()
     if not old or RANK[status]>RANK[old[0]] or (status=='failed' and old[0]=='sent'):
      self.db.execute('INSERT OR REPLACE INTO statuses VALUES(?,?)',(mid,status))
      self.db.execute('UPDATE messages SET status=? WHERE id=?',(status,mid))
    elif typ=='message':
     phone=e.get('phone',''); direction=e.get('direction')
     if not re.fullmatch(r'[0-9]{7,15}',phone) or direction not in ('in','out'): raise ValueError('Invalid contact')
     timestamp=e.get('timestamp',''); datetime.fromisoformat(timestamp.replace('Z','+00:00'))
     students=e.get('students',[])
     if not isinstance(students,list) or len(students)>30 or any(not isinstance(x,str) or len(x)>200 for x in students): raise ValueError('Invalid students')
     status=e.get('status','accepted' if direction=='out' else 'received')
     old=self.db.execute('SELECT status FROM statuses WHERE id=?',(mid,)).fetchone()
     if old: status=old[0]
     media=e.get('media')
     if media is not None and (not isinstance(media,dict) or not isinstance(media.get('reference'),str)): raise ValueError('Invalid media reference')
     self.db.execute('INSERT OR IGNORE INTO messages(id,phone,direction,text,kind,timestamp,status,name,students,media) VALUES(?,?,?,?,?,?,?,?,?,?)',(mid,phone,direction,str(e.get('text',''))[:20000],str(e.get('kind','text'))[:30],timestamp,status,str(e.get('name',''))[:200],json.dumps(students),json.dumps(media)))
    else: raise ValueError('Invalid event type')
    self.db.execute('INSERT INTO events VALUES(?)',(e['id'],))
   current=self.cursor()
   if not isinstance(cursor,int) or cursor<current: raise ValueError('Invalid checkpoint')
   self.db.execute('UPDATE checkpoints SET cursor=? WHERE id=1',(cursor,))
 def pending_media(self):
  return [json.loads(r[0]) for r in self.db.execute('SELECT event FROM media_jobs LIMIT 20')]
 def complete_media(self,e,content):
  if len(content)!=e['size'] or hashlib.sha256(content).hexdigest()!=e['sha256']: raise ValueError('Media integrity mismatch')
  event=dict(e,id='download:'+e['reference'],type='media',base64=base64.b64encode(content).decode())
  self.apply([event],self.cursor())
  with self.db: self.db.execute('DELETE FROM media_jobs WHERE reference=?',(e['reference'],))
 def media(self,ref): return self.db.execute('SELECT * FROM media WHERE id=?',(ref,)).fetchone()
 def cursor(self): return self.db.execute('SELECT cursor FROM checkpoints WHERE id=1').fetchone()[0]
 def conversations(self,q=''):
  rows=self.db.execute('SELECT * FROM messages ORDER BY timestamp,id').fetchall(); result={}
  for r in rows:
   x=result.setdefault(r['phone'],dict(phone=r['phone'],name='',students=[],preview='',timestamp='',unread=0))
   x.update(preview=r['text'],timestamp=r['timestamp'])
   if r['name']: x['name']=r['name']
   x['students']=sorted(set(x['students']+json.loads(r['students'])))
   x['unread']+=int(r['direction']=='in' and not r['seen'])
  return sorted([x for x in result.values() if q.lower() in json.dumps(x,ensure_ascii=False).lower()],key=lambda x:x['timestamp'],reverse=True)
 def messages(self,phone):
  result=[]
  for r in self.db.execute('SELECT * FROM messages WHERE phone=? ORDER BY timestamp,id',(phone,)):
   media=json.loads(r['media'])
   if media: media['available']=self.db.execute('SELECT 1 FROM media WHERE id=?',(media['reference'],)).fetchone() is not None
   result.append(dict(r,students=json.loads(r['students']),media=media))
  return result
 def seen(self,phone):
  with self.db: self.db.execute('UPDATE messages SET seen=1 WHERE phone=?',(phone,))
 def stats(self):
  return dict(messages=self.db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],conversations=self.db.execute('SELECT COUNT(DISTINCT phone) FROM messages').fetchone()[0],unread=self.db.execute("SELECT COUNT(*) FROM messages WHERE direction='in' AND seen=0").fetchone()[0],failed=self.db.execute("SELECT COUNT(*) FROM messages WHERE status='failed'").fetchone()[0])
