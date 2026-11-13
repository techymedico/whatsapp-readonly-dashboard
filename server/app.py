import os,json,secrets,time,threading,hmac,hashlib,urllib.request
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from http.cookies import SimpleCookie
from .store import Store
ROOT=Path(__file__).resolve().parent.parent

def main():
 password=os.environ.get('ADMIN_PASSWORD',''); sync=os.environ.get('SYNC_SECRET','')
 if len(password)<16: raise SystemExit('ADMIN_PASSWORD must have at least 16 characters')
 data=Path(os.environ.get('DATA_DIR','data')); data.mkdir(mode=0o700,exist_ok=True)
 store=Store(str(data/'history.sqlite3')); lock=threading.RLock(); sessions={}; attempts={}; state={'last_sync':None,'error':None}
 secure=os.environ.get('COOKIE_SECURE','true')=='true'
 def worker():
  url=os.environ.get('SYNC_URL','')
  if not url: return
  if not url.startswith('https://') or len(sync)<32: state['error']='Invalid synchronization configuration'; return
  delay=5
  while True:
   try:
    with lock: cursor=store.cursor()
    stamp=str(int(time.time())); path='?after='+str(cursor)
    sig=hmac.new(sync.encode(),(stamp+'\n'+str(cursor)).encode(),hashlib.sha256).hexdigest()
    req=urllib.request.Request(url+path,headers={'X-Sync-Time':stamp,'X-Sync-Signature':sig})
    with urllib.request.urlopen(req,timeout=20) as r:
     raw=r.read(16_000_001)
     if len(raw)>16_000_000: raise ValueError('Oversized batch')
     batch=json.loads(raw)
    with lock: store.apply(batch['events'],batch['cursor'])
    state.update(last_sync=time.time(),error=None); delay=5 if batch.get('has_more') else 30
   except Exception: state['error']='Synchronization unavailable; history retained and retry scheduled'; delay=min(delay*2,300)
   time.sleep(delay)
 def media_worker():
  from urllib.parse import quote
  url=os.environ.get('SYNC_MEDIA_URL','')
  if not url or not url.startswith('https://') or len(sync)<32: return
  while True:
   with lock: pending=store.pending_media()
   for e in pending:
    try:
     stamp=str(int(time.time())); ref=e['reference']
     signature=hmac.new(sync.encode(),(stamp+'\nmedia\n'+ref).encode(),hashlib.sha256).hexdigest()
     request=urllib.request.Request(url+'?reference='+quote(ref,safe=''),headers={'X-Sync-Time':stamp,'X-Sync-Signature':signature})
     with urllib.request.urlopen(request,timeout=30) as response: content=response.read(10_000_001)
     with lock: store.complete_media(e,content)
    except Exception: pass # Durable pending rows survive failures/restarts; retry next cycle.
   time.sleep(60)
 threading.Thread(target=media_worker,daemon=True).start()
 threading.Thread(target=worker,daemon=True).start()
 class Handler(BaseHTTPRequestHandler):
  def setup(self):
   super().setup(); self.connection.settimeout(20)
  def log_message(self,*args): pass
  def respond(self,code,obj,cookie=None):
   body=json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
   if cookie: self.send_header('Set-Cookie',cookie)
   self.end_headers(); self.wfile.write(body)
  def auth(self):
   try: c=SimpleCookie(self.headers.get('Cookie','')); token=c['session'].value
   except Exception: return False
   return sessions.get(token,0)>time.time()
  def do_POST(self):
   origin=self.headers.get('Origin')
   if origin and origin!=os.environ.get('PUBLIC_ORIGIN','http://localhost:3100'): return self.respond(403,{'error':'Invalid origin'})
   if self.headers.get('Sec-Fetch-Site')=='cross-site': return self.respond(403,{'error':'Invalid origin'})
   try:
    size=int(self.headers.get('Content-Length','0'))
    if size<0 or size>4096: raise ValueError()
    body=json.loads(self.rfile.read(size))
   except Exception: return self.respond(400,{'error':'Invalid request'})
   if self.path=='/api/login':
    ip=self.client_address[0]; now=time.time()
    with lock:
     attempts[ip]=[t for t in attempts.get(ip,[]) if t>now-300]
     if len(attempts[ip])>=10: return self.respond(429,{'error':'Try again in five minutes'})
     attempts[ip].append(now)
     if not hmac.compare_digest(str(body.get('password','')).encode(),password.encode()): return self.respond(401,{'error':'Incorrect password'})
     for t in list(sessions):
      if sessions[t]<now: del sessions[t]
     token=secrets.token_urlsafe(32); sessions[token]=now+28800
    return self.respond(200,{'ok':True},'session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800'+('; Secure' if secure else ''))
   if not self.auth(): return self.respond(401,{'error':'Sign in required'})
   if self.path=='/api/seen':
    with lock: store.seen(str(body.get('phone','')))
    return self.respond(200,{'ok':True})
   if self.path=='/api/logout':
    c=SimpleCookie(self.headers.get('Cookie','')); sessions.pop(c['session'].value,None)
    return self.respond(200,{'ok':True},'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
   self.respond(404,{'error':'Not found'})
  def do_GET(self):
   from urllib.parse import urlparse,parse_qs
   u=urlparse(self.path); q=parse_qs(u.query)
   if u.path=='/health': return self.respond(200,{'ok':True})
   if u.path.startswith('/api/'):
    if not self.auth(): return self.respond(401,{'error':'Sign in required'})
    with lock:
     if u.path=='/api/media':
      item=store.media(q.get('id',[''])[0])
      if not item: return self.respond(404,{'error':'File not mirrored'})
      self.send_response(200); self.send_header('Content-Type',item['mime']); self.send_header('Content-Disposition','inline' if item['mime'].startswith('image/') else 'attachment; filename="document.pdf"'); self.send_header('Cache-Control','private, no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('Content-Security-Policy',"default-src 'none'; sandbox"); self.end_headers(); self.wfile.write(item['bytes']); return
     if u.path=='/api/conversations': return self.respond(200,store.conversations(q.get('q',[''])[0]))
     if u.path=='/api/messages': return self.respond(200,store.messages(q.get('phone',[''])[0]))
     if u.path=='/api/stats': return self.respond(200,dict(store.stats(),sync=state))
    return self.respond(404,{'error':'Not found'})
   file=(ROOT/'web/dist'/u.path.lstrip('/')).resolve() if u.path!='/' else ROOT/'web/dist/index.html'
   base=(ROOT/'web/dist').resolve()
   if not file.is_relative_to(base) or not file.is_file(): return self.respond(404,{'error':'Not found'})
   import mimetypes
   self.send_response(200); self.send_header('Content-Type',mimetypes.guess_type(str(file))[0] or 'application/octet-stream'); self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"); self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(file.read_bytes())
 ThreadingHTTPServer((os.environ.get('BIND','127.0.0.1'),int(os.environ.get('PORT','3100'))),Handler).serve_forever()
if __name__=='__main__': main()
