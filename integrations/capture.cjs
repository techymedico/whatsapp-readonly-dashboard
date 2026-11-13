// Called ONLY after your existing webhook has verified the Meta signature.
const crypto = require('node:crypto');
const isoDate = value => {
  if (value && typeof value.toDate === 'function') value=value.toDate();
  const date=new Date(value || 0);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp');
  return date.toISOString();
};
const id = (...parts) =>
  crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
async function captureWebhook(
  payload,
  outbox,
  { businessId, phoneNumberId, lookup = async () => ({ students: [] }) }
) {
  for (const entry of payload.entry || []) {
    if (entry.id !== businessId) continue;
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (
        change.field !== 'messages' ||
        v.metadata?.phone_number_id !== phoneNumberId
      )
        continue;
      for (const m of v.messages || []) {
        const profile = (v.contacts || []).find(
          c => c.wa_id === m.from
        )?.profile;
        const contact = await lookup(m.from);
        const attachment = m[m.type];
        const text =
          m.text?.body ||
          attachment?.caption ||
          attachment?.filename ||
          m.interactive?.button_reply?.title ||
          m.interactive?.list_reply?.title ||
          m.button?.text ||
          '[' + m.type + ']';
        const e = {
          id: 'message:' + m.id,
          type: 'message',
          message_id: m.id,
          phone: m.from,
          direction: 'in',
          timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
          name: profile?.name || contact.name || '',
          students: contact.students || [],
          kind: m.type,
          text,
        };
        if (
          ['image', 'document', 'video', 'audio'].includes(m.type) &&
          attachment?.id
        )
          e.media = {
            reference: attachment.id,
            filename: attachment.filename || m.type,
          };
        await outbox.append(e);
      }
      for (const s of v.statuses || [])
        if (['sent', 'delivered', 'read', 'failed'].includes(s.status))
          await outbox.append({
            id: 'status:' + id(s.id, s.status),
            type: 'status',
            message_id: s.id,
            status: s.status,
          });
    }
  }
}
// Invoke from an idempotent on-write trigger; excludes SMS and unofficial records.
async function captureOutgoing(
  record,
  sourceId,
  outbox,
  contact = { students: [] }
) {
  if (
    record.provider !== 'official' ||
    (record.channel && record.channel !== 'whatsapp')
  )
    return false;
  const mid = record.message_id || 'attempt:' + sourceId;
  const raw = String(record.recipient_phone || '').replace(/\D/g, '');
  if (!raw) return false;
  const e = {
    id: 'message:' + mid,
    type: 'message',
    message_id: mid,
    phone: raw,
    direction: 'out',
    timestamp:
      isoDate(record.created_at || record.createdAt),
    name: contact.name || '',
    students: contact.students || [],
    text:
      record.message ||
      record.message_text ||
      record.rendered_message ||
      '[Message content was not retained]',
    kind: record.type || 'text',
    status: record.status || 'pending',
  };
  if (record.receipt_id || (record.type === 'whatsapp_receipt' && record.payment_id))
    e.media = {
      reference: 'receipt:' + (record.receipt_id || record.payment_id),
      filename: 'Fee receipt.pdf',
    };
  await outbox.append(e);
  if (
    ['accepted', 'sent', 'delivered', 'read', 'failed'].includes(record.status)
  )
    await outbox.append({
      id: 'status:' + id(mid, record.status),
      type: 'status',
      message_id: mid,
      status: record.status,
    });
  return true;
}
module.exports = { captureWebhook, captureOutgoing };
