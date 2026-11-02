# Sharif + Turso (staged; not deployed)

Selected URL: `libsql://sharif-prod-hemaatar.aws-ap-northeast-1.turso.io`

## What this version does

Sharif still uses synchronous `node:sqlite`. Instead of rewriting every API endpoint to async libSQL, this first-stage adapter stores a **compressed, checksummed SQLite snapshot** and generated thumbnails/VAPID material in a **single Turso row**. A successful API JSON response is delayed until the corresponding Turso write completes. A failed remote save returns HTTP 503.

**This is not a normalized Turso SQL schema.** It is a safe compatibility strategy for a single Render instance with small data. It does not support multiple concurrent app instances or large numbers of thumbnails. Every write transfers the whole compressed snapshot, so monitor Turso limits. Snapshot max size: 8 MiB; image max size: 8 MiB each.

## Activating

1. **Before deployment:** Export a fresh production backup of all entries, script bank, channels, settings, template and generated images. The live Render local SQLite instance is ephemeral. Do not assume the older GitHub backup contains new edits.
2. In Turso's `sharif-prod` database, create an auth token with read/write access. Never paste it into the repository or publish it. Do not send it via chat.
3. Add these **together** to the Sharif service's Render Environment:
   - `TURSO_DATABASE_URL=libsql://sharif-prod-hemaatar.aws-ap-northeast-1.turso.io`
   - `TURSO_AUTH_TOKEN=<private database token>`
4. Before merging, use an isolated staging service or a private test to confirm the token can perform Turso SELECT/INSERT and the remote snapshot can be restored.
5. **Migrate** the fresh production backup into the Turso snapshot before switching production. If the remote table is empty on first startup, the application seeds the default template: it cannot magically recover the old instance's data.
6. Only after verification, merge the PR and let Render's auto-deploy handle the build. Do not trigger another manual deploy.

## Fail-safe behavior

- If either environment variable is configured without the other, the service fails to boot rather than fall back to ephemeral storage.
- If Turso is unavailable, the server refuses a successful API response for data it could not durably persist.
- Remote revisions use compare-and-swap to block overwriting data from another process.
- A remote integrity mismatch prevents startup.
- The test suite uses a mocked Turso HTTP protocol; it is not proof of live token or remote endpoint compatibility.

## Performance and future roadmap

This Turso database is hosted in Tokyo (`aws-ap-northeast-1`), while Sharif's Render instance currently runs in Oregon; cross-region latency will slow every successful save. For long-term scale, convert the synchronous store to direct async `@libsql/client` SQL operations, move thumbnails to object storage, and place the database near the application.

Do not merge this branch automatically. Authentication credentials and a fresh pre-cutover data export are required.
