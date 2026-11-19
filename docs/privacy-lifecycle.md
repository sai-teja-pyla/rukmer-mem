# Memory privacy and lifecycle

Rukmer stores customer memory so agents can recall it later. It does not train models on that memory. A provider model only sees the prompt built for the current request.

The open-core engine keeps one JSON document (`engine.json`), not a SQL database. Row isolation is a storage gate in `engine/governance.ts`: every read, export, and search with an actor drops rows that fail `canRead`. Application routes cannot bypass it by passing another user's container tag.

## Data model

Each document, chunk, and fact keeps its existing id. That id is `memory_id`. A `gov` object on the row adds:

| Field | Meaning |
| --- | --- |
| `ownerId` | User who owns the memory |
| `tenantId` | Home tenant `u_{user}` or org id `org_{id}` |
| `visibility` | `private` (default), `team`, or `org` |
| `createdBy` | User who wrote it |
| `sourceRef` | Source message or thread id, when the caller sends one |
| `memoryKind` | `session`, `working`, `context`, `summary`, `preference`, `fact`, `decision` |
| `extraction` | How it was produced (`heuristic`, `model`, `manual`) |
| `expiresAt` | When retention takes effect |
| `teamId` | Set when visibility is `team` |
| `redacted` | Categories masked before the write |

`source` stays on the document and chunk (the tool or API that sent it). Teams, retention policies, redaction policies, the audit log, and erasure receipts live beside the memory rows in the same store.

Existing rows are stamped on boot. An org container stays org-visible. A user container stays private to that user. New writes default to `private`, including writes into an org container. Sharing requires an explicit `visibility: "org"`, `visibility: "team"`, or MCP `scope: "team"`. A team memory is stored in `tm_{teamId}` and stamped with the org as `tenantId`, not the author's home tag. Reads go through `readableSpaces`: the caller's home tag, active team spaces, and orgs. A removed member loses team rows on the next request, including memories they wrote. Team memories do not get the 30-day context expiry.

Joining a team is an invite. The owner shares a link, code, or QR. The teammate accepts while signed in. Both confirm the same 6-emoji code before membership is active. Personal memories never move unless the author calls `POST /v4/memories/:id/move`.

## Write

1. Resolve the caller and the container. A caller cannot write into another user's home.
2. Assign scope. Missing visibility becomes `private`.
3. Redact. Credentials, payment cards (Luhn), SSNs, and a small set of special-category phrases are masked. A tenant admin can set each category to `mask`, `drop`, or `allow`. `drop` rejects the write. Nothing from a dropped category is stored.
4. Extract facts from the redacted text, then store the document, chunks, embeddings, and facts with the same `gov` stamp.
5. Append an audit row: actor, memory id, tenant, time, purpose. The row does not contain the memory text.

## Read

Search, document open, list, graph, profile injection, and export call `canRead`:

- `private`: owner only
- `team`: owner or a member of `teamId`
- `org`: owner or a member of that org

Expired, archived, and deleted rows are not returned. Search passes the signed-in user into the ranker, so a matching vector in another tenant is discarded even if a tag were wrong.

## Delete

`DELETE /v4/memories` and `DELETE /v4/governance/memories/:id` erase the row. Erasure also removes its chunks, fact embeddings, file blob, and links. The inverted index and vector index rebuild on the next save, so the deleted text is gone from retrieval. `POST /v4/governance/forget` erases one memory, one owner, or one tenant. `dryRun: true` returns the ids and writes nothing.

Soft archive is the retention action `archive`: the row is hidden, its text and embedding are cleared, and `archived` is set. `purge` hard-erases.

## Retention

Default lifetimes when a tenant has no policy:

| Kind | Days | Action |
| --- | --- | --- |
| session | 7 | purge |
| working | 14 | purge |
| context | 30 | archive |
| summary | 180 | archive |
| preference, fact, decision | 365 | archive |

`ttlDays: 0` keeps that kind. The engine sweeps on boot and every 15 minutes. Admins change a policy with `PUT /v4/governance/retention`.

## Encryption

Production requires encryption at rest. `MEMORY_DATA_KEY` must be 64 hex characters and is mounted from Secret Manager, not written into a plain environment variable. Boot refuses to start when that key is missing or malformed, when `MEMORY_GCS_BUCKET` is unset, or when the store bucket is still anonymously readable or listable. `GET /health` reports `encryptionAtRest: true` once the key is loaded. The public health body does not describe the store or list providers.

The store is AES-256-GCM. `encodeState` always uses the current key and records a short key id (`kid`) on the envelope. `MEMORY_DATA_KEY_PREVIOUS` is decrypt-only: the first successful boot rewrites an unencrypted store, or one opened with the previous key, under the current key. Back the key up offline. If it is lost, the store cannot be read.

Transit to `app.rukmer.com` is HTTPS. The process still keeps the working copy in memory so search can run. Local development may hash a passphrase when the value is not 64 hex characters. Production does not. Operator steps, bucket IAM, and the post-incident checks are in `docs/runbook-storage.md`.

## Customer controls

- `GET /v4/governance` — policies, defaults, and `training: false`
- `PUT /v4/governance/retention` and `PUT /v4/governance/redaction`
- `POST /v4/governance/expiry`
- `POST /v4/governance/forget` — memory, owner, or tenant, with dry-run
- `GET /v4/governance/export` — caller export, or `?tenantId=` for a tenant admin
- `GET /v4/governance/audit` — the caller's rows; a tenant admin also sees that tenant
- `POST /v4/governance/teams` and `POST /v4/governance/teams/members`

Audit and erasure receipts are capped (2,000 and 500) so the single store cannot grow without bound.
