# Deployment checklist

1. Run Python and Node tests and `npm ci && npm run build` in `web`.
2. Choose a hostname and point its A record at the host. This public repository intentionally contains no real domain, server IP, account IDs or school records.
3. Set a unique password and sync secret in a root-readable environment file, never in Git or command output.
4. Run behind HTTPS using the provided Docker configuration or a hardened service. Only TCP 443 should reach the application through the proxy; keep 3100 loopback-only.
5. Configure `PUBLIC_ORIGIN` to the exact HTTPS origin and keep `COOKIE_SECURE=true`.
6. Integrate the Firebase outbox adapter, with your existing signature validation and explicit business/phone-number allowlist. This is a separate production change requiring approval.
7. Add retry-enabled outgoing-log triggers and a reconciliation sweep. Use stable event IDs. Test the field mapping on synthetic snapshots before backfill.
8. Deny client access to both `readonly_bridge_events` and `readonly_bridge_control` in Firestore rules. Only your server-side Admin SDK should access them.
9. Set `SYNC_URL` and `SYNC_SECRET` on Oracle. Never copy Meta sending credentials.
10. Send a synthetic message event through the outbox, verify it appears once, restart Oracle, replay the event and verify unchanged counts.
11. Restore a database backup into an isolated instance. Confirm the checkpoint is restored with history.

## Media events
The local replica accepts PNG, JPEG and PDF bytes as authenticated `media` events. Include `message_id`, a unique event `id`, `reference`, `mime`, `filename` and `base64`. Files are served only behind administrator authentication; PDF content is downloaded rather than embedded as executable content.

Firestore documents are limited in size: for production media, store bytes in private Cloud Storage and add a dedicated authenticated binary export endpoint. Do not put large base64 files in the Firestore outbox. The provided media-event mechanism is suitable for local tests and small assets; `integrations/media.cjs` now provides a signed binary endpoint with integrity descriptors; configure `SYNC_MEDIA_URL` on the reader and wire the archive into the host trigger. Media retention and deletion must also be configured before student attachments are mirrored.

## HTTPS example (Caddy)

```caddyfile
inbox.example.org {
    reverse_proxy 127.0.0.1:3100
}
```

## Backup
Stop the app briefly or use Python's `sqlite3.Connection.backup()` to produce a consistent snapshot. Encrypt off-host backups. Do not commit backups to this repository.

## Host integration
`host-adapter.cjs` persists verified webhook envelopes before acknowledgment, expands incoming messages using the parent lookup, and maps both outgoing log collections. It accepts historical notification jobs only when a Meta `wamid.` proves their origin. Backfill pages are resumable and idempotent; run separately from sending. Keep the existing webhook signature validation and return a retryable error if persistence fails.

The Firebase trigger example includes inbound processing and both outgoing collections. Enable only after account/phone allowlists are set. Archive media in the existing private bucket using `createMedia`; inject `downloadMedia` with the existing server-side credential loader. Unsupported media remains a reference. No sending credential belongs on Oracle. PDF receipt references are preserved; do not regenerate a historical document as though it were the original.

Private media is limited to PNG, JPEG and PDF up to 10 MB. Failed transfers remain in SQLite and retry once a minute without blocking message history. Decide a retention period before enabling archival, and apply deletion to both the bucket and the replica.
