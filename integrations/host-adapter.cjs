// Server-side only. Does not import Firebase, register routes, or send messages.
const crypto = require('node:crypto');
const {captureWebhook,captureOutgoing}=require('./capture.cjs');
const phone = value => {let p=String(value||'').replace(/\D/g,'');return p.length===10?'91'+p:p;};
function createHostAdapter({db,outbox,businessId,phoneNumberId,archiveMedia,downloadMedia}) {
  if(!businessId||!phoneNumberId) throw new Error('Explicit account and phone allowlist required');
  const inbox=db.collection('readonly_bridge_inbox');
  async function lookup(number) {
    const p=phone(number), values=[p];
    if(p.startsWith('91')&&p.length===12) values.push(p.slice(2));
    const found=await db.collection('students').where('parent_mobile','in',values).get();
    const students=found.docs.map(d=>d.data());
    return {name:students.find(s=>s.parent_name)?.parent_name||'',students:[...new Set(students.map(s=>s.name).filter(Boolean))]};
  }
  // Call only AFTER the primary webhook validates the raw Meta signature.
  // Persistence is independent of Oracle availability. Failed persistence must
  // return a retryable webhook response; existing status processing is idempotent.
  async function acceptVerified(payload) {
    const filtered={entry:(payload.entry||[]).filter(e=>e.id===businessId).map(e=>({id:e.id,changes:(e.changes||[]).filter(c=>c.field==='messages'&&c.value?.metadata?.phone_number_id===phoneNumberId)})).filter(e=>e.changes.length)};
    if(!filtered.entry.length)return;
    const key=crypto.createHash('sha256').update(JSON.stringify(filtered)).digest('hex');
    try {await inbox.doc(key).create({payload:filtered,created_at:new Date().toISOString()});}
    catch(e){if(e.code!==6&&e.code!=='already-exists')throw e;}
  }
  async function processInbound(record) {
    await captureWebhook(record.payload,outbox,{businessId,phoneNumberId,lookup});
    if(archiveMedia&&downloadMedia) for(const entry of record.payload.entry||[]) {
      if(entry.id!==businessId)continue;
      for(const change of entry.changes||[]) {
        if(change.field!=='messages'||change.value?.metadata?.phone_number_id!==phoneNumberId)continue;
        for(const m of change.value.messages||[]) {
          const media=m[m.type];
          if(!['image','document'].includes(m.type)||!media?.id||!['image/png','image/jpeg','application/pdf'].includes(media.mime_type))continue;
          const bytes=await downloadMedia(media.id,media.mime_type);
          await archiveMedia({message_id:m.id,reference:media.id,mime:media.mime_type,filename:media.filename||m.type,bytes});
        }
      }
    }
  }
  async function processOutgoing(record,sourceId) {
    // Older notification jobs lack a provider. A Meta wamid is positive evidence;
    // never infer historic provider from the current settings switch.
    const official=record.provider==='official'||String(record.message_id||'').startsWith('wamid.');
    if(!official||record.type?.startsWith('sms')||record.channel==='sms')return false;
    const normalized={...record,provider:'official',recipient_phone:phone(record.recipient_phone),type:record.type,
      message:record.message||record.message_text||record.rendered_message||(record.type==='whatsapp_receipt'?'Fee receipt':'[Message content was not retained]')};
    if(!normalized.recipient_phone)return false;
    return captureOutgoing(normalized,sourceId,outbox,await lookup(normalized.recipient_phone));
  }
  // Paginate by document id with a persisted checkpoint in the caller. Replaying
  // any page is safe. on-write triggers remain responsible for subsequent changes.
  async function backfillPage(collection,after='',limit=100) {
    if(!['whatsapp_logs','notification_jobs'].includes(collection))throw new Error('Unsupported source');
    let q=db.collection(collection).orderBy('__name__').limit(Math.min(100,Math.max(1,limit)));
    if(after)q=q.startAfter(after);
    const page=await q.get();
    for(const d of page.docs)await processOutgoing(d.data(),collection+':'+d.id);
    return {cursor:page.docs.at(-1)?.id||after,done:page.docs.length<limit,examined:page.docs.length};
  }
  return {acceptVerified,processInbound,processOutgoing,backfillPage};
}
module.exports={createHostAdapter,phone};
