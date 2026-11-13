// Opt-in adapter. Importing this file does not install routes or modify webhooks.
const crypto = require('node:crypto');
function createOutbox(db, secret) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('Use a dedicated sync secret of at least 32 characters');
  const events = db.collection('readonly_bridge_events');
  const counter = db.collection('readonly_bridge_control').doc('sequence');
  async function append(event) {
    if (
      !event ||
      !event.id ||
      !event.message_id ||
      !['message', 'status', 'media_ref'].includes(event.type)
    )
      throw new Error('Invalid event');
    const id = crypto.createHash('sha256').update(event.id).digest('hex');
    return db.runTransaction(async tx => {
      const ref = events.doc(id);
      const [existing, count] = await Promise.all([
        tx.get(ref),
        tx.get(counter),
      ]);
      if (existing.exists) return;
      const sequence = (count.data()?.sequence || 0) + 1;
      tx.set(ref, { sequence, event });
      tx.set(counter, { sequence });
    });
  }
  async function handler(req, res) {
    res.set('Cache-Control', 'no-store');
    const after = Number(req.query.after),
      stamp = req.get('x-sync-time');
    if (
      req.method !== 'GET' ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !/^\d{10}$/.test(stamp || '') ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 120
    )
      return res.status(401).json({ error: 'Unauthorized' });
    const expected = crypto
      .createHmac('sha256', secret)
      .update(stamp + '\n' + after)
      .digest('hex');
    const supplied = req.get('x-sync-signature') || '';
    if (
      !/^[a-f0-9]{64}$/.test(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    )
      return res.status(401).json({ error: 'Unauthorized' });
    const snap = await events
      .where('sequence', '>', after)
      .orderBy('sequence')
      .limit(100)
      .get();
    const rows = snap.docs.map(d => d.data());
    return res.json({
      events: rows.map(x => x.event),
      cursor: rows.length ? rows.at(-1).sequence : after,
      has_more: rows.length === 100,
    });
  }
  return { append, handler };
}
module.exports = { createOutbox };
