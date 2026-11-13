import unittest,subprocess,os,tempfile,time,json,urllib.request,urllib.error,socket
class HttpTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(); s=socket.socket();s.bind(('127.0.0.1',0));cls.port=s.getsockname()[1];s.close()
  cls.proc=subprocess.Popen(['python3','-m','server.app'],env=dict(os.environ,ADMIN_PASSWORD='test-password-not-real-1234',COOKIE_SECURE='false',PORT=str(cls.port),DATA_DIR=cls.tmp.name,SYNC_URL=''),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for _ in range(100):
   try:urllib.request.urlopen(f'http://127.0.0.1:{cls.port}/health');break
   except Exception:time.sleep(.05)
 @classmethod
 def tearDownClass(cls):cls.proc.terminate();cls.proc.wait();cls.tmp.cleanup()
 def request(self,path,body=None,headers={}):
  r=urllib.request.Request(f'http://127.0.0.1:{self.port}'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**headers})
  try:return urllib.request.urlopen(r)
  except urllib.error.HTTPError as e:return e
 def test_auth(self):self.assertEqual(self.request('/api/stats').status,401)
 def test_login_cookie_and_logout(self):
  r=self.request('/api/login',{'password':'test-password-not-real-1234'});cookie=r.headers['Set-Cookie'];self.assertIn('HttpOnly',cookie)
  self.assertEqual(self.request('/api/stats',headers={'Cookie':cookie}).status,200)
  self.request('/api/logout',{},headers={'Cookie':cookie});self.assertEqual(self.request('/api/stats',headers={'Cookie':cookie}).status,401)
 def test_csrf(self):self.assertEqual(self.request('/api/login',{'password':'test-password-not-real-1234'},headers={'Origin':'https://evil.example'}).status,403)
 def test_media_private(self):self.assertEqual(self.request('/api/media?id=x').status,401)
 def test_no_send_api(self):self.assertEqual(self.request('/api/send',{}).status,401)
 def test_static_traversal(self):self.assertEqual(self.request('/../../server/app.py').status,404)
