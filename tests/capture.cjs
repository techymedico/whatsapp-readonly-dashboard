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
