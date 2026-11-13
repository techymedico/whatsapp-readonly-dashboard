# Architecture and integration plan

## Boundaries
The existing application remains the only Meta webhook and message sender. The dashboard has no access token, sending routes, campaign engine or Meta network client. Its shared sync secret grants access only to an application-specific read feed.

SQLite (WAL, FULL synchronous) suits a small school's single-server workload: one durable volume, no database service, inexpensive backups. PostgreSQL becomes appropriate for multiple dashboard replicas or sustained concurrent writes. Never put this SQLite file on a network filesystem.

## Durable flow
1. Existing webhook validates Meta signature as before.
2. Persist a normalized event to an opt-in Firestore outbox, before acknowledging the webhook. Duplicate IDs are harmless. If persistence fails, return a retryable response rather than silently dropping the event.
3. Capture outgoing messages from existing durable send-job/log records using an idempotent Firestore trigger. Do not make message sending depend on Oracle availability. This trigger and a periodic reconciliation sweep must be installed in the host application before live activation.
4. Oracle polls the authenticated HTTPS feed. HMAC signs the timestamp and cursor; the server allows 120 seconds of clock skew. TLS authenticates the response. Keep the secret separate from all Meta credentials.
5. Insert the batch and advance its checkpoint in one SQLite transaction. On crash, replay the batch. Status events can arrive before message content and never downgrade a read/delivered message.
6. Retain source events until a deliberate, backed-up retention policy exists. The included adapter never deletes them. Do not reset the source sequence without rebuilding the replica.

## Repository review
Upstream's MIT-licensed `whatsapp_webhook.py` is preserved with its licence. The normalization adapter reuses its incoming parsing. JSONL storage is replaced by SQLite for indexed conversations, deduplication, checkpoints and delivery status. Upstream's direct Meta HTTP listener and Telegram/Discord forwarding are not used.

## Existing application findings (local inspection)
The existing signature-validated webhook updates notification job and WhatsApp log statuses by Meta message ID. Ordinary inbound parent messages are not persisted in that handler. The screenshot workflow is gated to emulator test mode. Therefore pre-installation incoming conversations cannot be promised or reconstructed from status logs.
Outgoing logs may supply message content, recipients, templates and receipt references, but only fields actually stored can be backfilled. Status-only records cannot reconstruct text. A collection inventory and an approved dry-run mapping are required before importing real records. Never infer parent names or assign a shared number to just one child.

## Incremental release
- Stage 1: isolated dashboard, synthetic fixtures, durable store and authenticated pull protocol.
- Stage 2: review host application's log schemas and add optional capture/trigger adapters in a separate branch. Test Firestore retries and backfill against emulators.
- Stage 3: explicit approval to deploy the Firebase capture endpoint; no Meta webhook change.
- Stage 4: HTTPS Oracle deployment and controlled synchronization test, then enable ongoing sync.

## Media
Current version displays media/receipt references only. It deliberately does not fetch Meta media or expose external URLs. Full private image/PDF previews require a separate authenticated binary export from Firebase, a restricted Oracle media store, retention limits, MIME/content validation and tests. Meta sending credentials must remain on Firebase. Historical ephemeral PDFs may no longer exist. Do not label a reference as a downloadable receipt when bytes are unavailable.

## Cost
No new subscription is required for the dashboard stack. Firebase event writes, feed reads, media storage/egress and function invocations still count toward existing billing. A 30-second idle poll can produce approximately 2,880 feed calls per day; increase the interval or implement adaptive idle polling before production if this is material. Oracle eligibility and quotas are account-specific. Open-source does not guarantee zero usage charges.
