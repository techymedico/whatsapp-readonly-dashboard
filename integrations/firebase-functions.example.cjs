// EXAMPLE ONLY. Merge explicitly into the host application's existing initialization.
// Never run a second initializeApp() if the host already initializes Firebase.
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore } = require('firebase-admin/firestore');
const { createOutbox } = require('./firebase-outbox.cjs');
const { captureOutgoing } = require('./capture.cjs');
const syncSecret = defineSecret('READONLY_BRIDGE_SYNC_SECRET');
const enabled = () => process.env.READONLY_BRIDGE_ENABLED === 'true';
exports.readonlyFeed = onRequest(
  { secrets: [syncSecret] },
  async (req, res) => {
    if (!enabled()) return res.status(503).json({ error: 'Disabled' });
    return createOutbox(getFirestore(), syncSecret.value()).handler(req, res);
  }
);
// Adapt provider and contact field mappings to actual retained records before enabling.
exports.readonlyLogCapture = onDocumentWritten(
  { document: 'whatsapp_logs/{id}', retry: true, secrets: [syncSecret] },
  async event => {
    if (!enabled() || !event.data.after.exists) return;
    await captureOutgoing(
      event.data.after.data(),
      event.params.id,
      createOutbox(getFirestore(), syncSecret.value())
    );
  }
);
// Add notification_jobs capture only after checking channel/provider mappings.
// Add captureWebhook to the EXISTING signed webhook; never register another Meta callback.
