// Private binary export. The Oracle reader receives only a dedicated HMAC secret.
const crypto=require('node:crypto');
const MAX=10_000_000;
const signatures={'image/png':Buffer.from('89504e470d0a1a0a','hex'),'image/jpeg':Buffer.from('ffd8ff','hex'),'application/pdf':Buffer.from('%PDF-')};
function validate(bytes,mime){if(!signatures[mime]||bytes.length>MAX||!bytes.subarray(0,signatures[mime].length).equals(signatures[mime]))throw Error('Unsupported or invalid media');}
function createMedia({bucket,secret,outbox}) {
 const key=ref=>{if(!/^[A-Za-z0-9_.:-]{1,256}$/.test(ref))throw Error('Invalid reference');return crypto.createHash('sha256').update(ref).digest('hex');};
 async function archive({message_id,reference,mime,filename,bytes}) {
  validate(bytes,mime);
  const hash=crypto.createHash('sha256').update(bytes).digest('hex');
  await bucket.file('readonly-bridge/'+key(reference)).save(bytes,{resumable:false,metadata:{contentType:mime,cacheControl:'private, no-store'}});
  await outbox.append({id:'media:'+reference,type:'media_ref',message_id,reference,mime,filename:filename||'attachment',sha256:hash,size:bytes.length});
 }
 async function handler(req,res){
  res.set('Cache-Control','private, no-store');
  const ref=req.query.reference,stamp=req.get('x-sync-time'),sig=req.get('x-sync-signature')||'';
  if(req.method!=='GET'||typeof ref!=='string'||!/^\d{10}$/.test(stamp||'')||Math.abs(Date.now()/1000-Number(stamp))>120||!/^[a-f0-9]{64}$/.test(sig))return res.status(401).end();
  const expected=crypto.createHmac('sha256',secret).update(stamp+'\nmedia\n'+ref).digest('hex');
  if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return res.status(401).end();
  let path;try{path=key(ref);}catch{return res.status(400).end();}
  try{const [bytes]=await bucket.file('readonly-bridge/'+path).download();if(bytes.length>MAX)throw Error('Too large');res.set('Content-Type','application/octet-stream');return res.send(bytes);}
  catch{return res.status(404).end();}
 }
 return {archive,handler};
}
module.exports={createMedia,validate};
