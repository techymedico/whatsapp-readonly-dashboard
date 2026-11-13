const test=require('node:test'),assert=require('node:assert/strict');
const {createMedia,validate}=require('../integrations/media.cjs');
test('binary archive contains no public URL and emits integrity descriptor',async()=>{
 let saved,event;const media=createMedia({bucket:{file:path=>({save:async b=>{saved={path,b}}})},secret:'test',outbox:{append:async e=>event=e}});
 await media.archive({message_id:'m',reference:'ref',mime:'application/pdf',bytes:Buffer.from('%PDF-example')});
 assert.equal(event.type,'media_ref');assert.equal(event.size,12);assert.match(event.sha256,/^[a-f0-9]{64}$/);assert.ok(saved.path.startsWith('readonly-bridge/'));assert.equal(event.url,undefined);
});
test('media rejects executable files and bad file signatures',()=>{assert.throws(()=>validate(Buffer.from('<script>'),'text/html'));assert.throws(()=>validate(Buffer.from('<script>'),'application/pdf'));});
test('binary endpoint denies unsigned requests before storage access',async()=>{
 const media=createMedia({bucket:{file:()=>{throw Error('Must not read')}},secret:'secret',outbox:{}});
 const res={set(){},status(n){this.code=n;return this},end(){}};
 await media.handler({method:'GET',query:{reference:'ref'},get:()=>''},res);assert.equal(res.code,401);
});
const {downloadMedia}=require('../integrations/download-media.cjs');
test('download does not send token to unexpected hosts',async()=>{
 let calls=0;
 await assert.rejects(downloadMedia('123','application/pdf',{token:'fake',version:'v23.0',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({url:'https://attacker.example/file'})}}}),/Unexpected media host/);
 assert.equal(calls,1);
});
