// Opt-in host wiring. Load only after the host initializes firebase-admin.
const {onDocumentWritten,onDocumentCreated}=require('firebase-functions/v2/firestore');
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore}=require('firebase-admin/firestore');
const {createOutbox}=require('./firebase-outbox.cjs');
const {createHostAdapter}=require('./host-adapter.cjs');
const syncSecret=defineSecret('READONLY_BRIDGE_SYNC_SECRET');
const enabled=()=>process.env.READONLY_BRIDGE_ENABLED==='true';
function adapter(){return createHostAdapter({db:getFirestore(),outbox:createOutbox(getFirestore(),syncSecret.value()),businessId:process.env.READONLY_BRIDGE_BUSINESS_ID,phoneNumberId:process.env.READONLY_BRIDGE_PHONE_ID});}
exports.readonlyFeed=onRequest({region:'us-central1',secrets:[syncSecret],maxInstances:2},async(req,res)=>{
 if(!enabled())return res.status(503).json({error:'Disabled'});
 return createOutbox(getFirestore(),syncSecret.value()).handler(req,res);
});
exports.readonlyInbound=onDocumentCreated({document:'readonly_bridge_inbox/{id}',region:'us-central1',retry:true,secrets:[syncSecret],maxInstances:2},async event=>{
 if(!enabled()||!event.data)return;
 await adapter().processInbound(event.data.data());
});
for(const [name,collection] of [['readonlyLogCapture','whatsapp_logs'],['readonlyJobCapture','notification_jobs']]){
 exports[name]=onDocumentWritten({document:collection+'/{id}',region:'us-central1',retry:true,secrets:[syncSecret],maxInstances:2},async event=>{
  if(!enabled()||!event.data.after.exists)return;
  await adapter().processOutgoing(event.data.after.data(),collection+':'+event.params.id);
 });
}
// In the EXISTING verified webhook, inside its retryable try/catch:
// if (process.env.READONLY_BRIDGE_ENABLED === 'true') {
//   await createHostAdapter({db, outbox:null,
//     businessId:process.env.READONLY_BRIDGE_BUSINESS_ID,
//     phoneNumberId:process.env.READONLY_BRIDGE_PHONE_ID}).acceptVerified(req.body);
// }
// Only the inbound trigger needs the sync secret; webhook capture never contacts Oracle.
