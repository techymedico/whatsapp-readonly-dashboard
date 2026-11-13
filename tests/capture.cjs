const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  captureWebhook,
  captureOutgoing,
} = require('../integrations/capture.cjs');
test('capture incoming shared-parent and statuses; filter account', async () => {
  const events = [];
  const outbox = { append: async e => events.push(e) };
  const value = {
    metadata: { phone_number_id: 'test-phone' },
    contacts: [{ wa_id: '15550001001', profile: { name: 'Example Parent' } }],
    messages: [
      {
        id: 'm1',
        from: '15550001001',
        type: 'text',
        text: { body: 'Hello' },
        timestamp: '1767268800',
      },
    ],
    statuses: [{ id: 'm2', status: 'read' }],
  };
  await captureWebhook(
    {
      entry: [{ id: 'test-business', changes: [{ field: 'messages', value }] }],
    },
    outbox,
    {
      businessId: 'test-business',
      phoneNumberId: 'test-phone',
      lookup: async () => ({ students: ['Example One', 'Example Two'] }),
    }
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].students.length, 2);
  await captureWebhook(
    { entry: [{ id: 'other', changes: [{ field: 'messages', value }] }] },
    outbox,
    { businessId: 'test-business', phoneNumberId: 'test-phone' }
  );
  assert.equal(events.length, 2);
});
test('outgoing content and status; exclude other channels', async () => {
  const events = [];
  const o = { append: async e => events.push(e) };
  await captureOutgoing(
    {
      provider: 'official',
      recipient_phone: '15550001001',
      message_id: 'm3',
      message: 'Test',
      status: 'read',
      created_at: '2026-01-01T00:00:00Z',
    },
    'x',
    o
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].text, 'Test');
  assert.equal(await captureOutgoing({ provider: 'openwa' }, 'x', o), false);
});
const {createHostAdapter,phone}=require('../integrations/host-adapter.cjs');
test('host mapping recognizes Meta jobs and excludes SMS and unofficial jobs',async()=>{
 const events=[];const db={collection:()=>({where:()=>({get:async()=>({docs:[{data:()=>({name:'Example One',parent_name:'Parent'})},{data:()=>({name:'Example Two'})}]})})})};
 const a=createHostAdapter({db,outbox:{append:async e=>events.push(e)},businessId:'business',phoneNumberId:'phone'});
 assert.equal(phone('99999 00000'),'919999900000');
 assert.equal(await a.processOutgoing({message_id:'wamid.example',recipient_phone:'9999900000',type:'whatsapp_reminder',message:'Hello',created_at:'2026-01-01T00:00:00Z'},'job'),true);
 assert.equal(events[0].students.length,2);
 assert.equal(events[0].phone,'919999900000');
 assert.equal(await a.processOutgoing({message_id:'unofficial',recipient_phone:'9999900000'},'job'),false);
 assert.equal(await a.processOutgoing({message_id:'wamid.sms',type:'sms_reminder'},'job'),false);
});
test('durable inbound capture ignores unrelated accounts and propagates storage failure',async()=>{
 let writes=0;const a=createHostAdapter({db:{collection:()=>({doc:()=>({create:async()=>{writes++;throw Error('offline')}})})},outbox:{},businessId:'business',phoneNumberId:'phone'});
 await a.acceptVerified({entry:[{id:'other',changes:[]}]});assert.equal(writes,0);
 await assert.rejects(a.acceptVerified({entry:[{id:'business',changes:[{field:'messages',value:{metadata:{phone_number_id:'phone'},messages:[]}}]}]}),/offline/);
 assert.equal(writes,1);
});
