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

Existing rows are stamped on boot. An org container stays org-visible. A user container stays private to that user. New writes default to `private`, including writes into an org container. Sharing requires `visibility: "org"` or `visibility: "team"`. A team memory is stored in `tm_{teamId}`. A home search includes the teams the caller belongs to. Org memory stays on the org container and is searched when the caller asks for that org.

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

**Warning:** encryption at rest is optional. If `MEMORY_DATA_KEY` is missing, the memory store is plaintext JSON on disk and in Cloud Storage. `GET /health` and `GET /v4/governance` report `encryptionAtRest: false` and set `encryptionWarning` to that fact. Existing stores keep opening without a key.

Transit to `app.rukmer.com` is HTTPS. To encrypt the file, set `MEMORY_DATA_KEY` to 64 hex characters or a passphrase. The store is then AES-256-GCM. The process still keeps plaintext in memory so search can run. With the key set, `encryptionWarning` is null.

## Customer controls

- `GET /v4/governance` — policies, defaults, and `training: false`
- `PUT /v4/governance/retention` and `PUT /v4/governance/redaction`
- `POST /v4/governance/expiry`
- `POST /v4/governance/forget` — memory, owner, or tenant, with dry-run
- `GET /v4/governance/export` — caller export, or `?tenantId=` for a tenant admin
- `GET /v4/governance/audit` — the caller's rows; a tenant admin also sees that tenant
- `POST /v4/governance/teams` and `POST /v4/governance/teams/members`

Audit and erasure receipts are capped (2,000 and 500) so the single store cannot grow without bound.
