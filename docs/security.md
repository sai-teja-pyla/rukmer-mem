# Security controls

These controls sit on the memory engine that already isolates rows, requires a session, and redacts secrets. Identity comes from the verified session. A client field never promotes the caller.

## What is enforced

| Control | Where | How to verify |
| --- | --- | --- |
| Session identity | `engine/identity.ts`, `engine/security.ts` | `POST /v4/search` as user A with `uid` / `actorId` / `userId` set to user B returns 403. `x-rukmer-user` works only on loopback, outside production, and only when `MEMORY_REQUIRE_AUTH` is unset. |
| Object checks | `engine/governance.ts`, `GET /v3/files/:id` | User B receives 404 for user A's document and file, and 403 on delete or bulk forget. |
| Input handling | `sanitizePlain`, `sanitizeName`, `checkUpload` | Null bytes are stripped. Search treats filter keys and query text as data. SVG and other unexpected types return 415. Files over 8MB (25MB for video) return 413. Content must match the declared type. |
| Rate limits | in-memory, per user and IP, 60-second window | Auth 30, writes 60, search 120, export 10, forget 30, admin 30, upload 20. Over the budget the response is 429 with `Retry-After`. Limits are per process. |
| Tools | `TOOL_ALLOWLIST` | Only `searchMemories` and `addMemory`. Both require the signed-in user. Model tool calls in the router use that same user. Chat text does not invoke a tool by itself. |
| Private files | `DATA_DIR/files` and `engine/files/` in the bucket | No public URL. `GET /v3/files/:id` checks the session and `canRead` on the owning document. |
| Admin actions | governance and org routes | Retention, redaction, tenant export, and expiry of another tenant require a tenant admin. Org and team membership changes, API key create/revoke, retention, and redaction are written to the audit log with actor, action, target, time, and `result=ok`. |
| Headers | `securityMiddleware` | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` with camera, microphone, geolocation, and payment disabled, and a CSP of `default-src 'self'` with inline styles and HTTPS images/connect. `Strict-Transport-Security` is set in production. |
| CORS | `ALLOWED_ORIGINS` | Credentials are sent only for the console origins (local Vite, app.rukmer.com, rukmer.com, Firebase Hosting, the Cloud Run host). Other origins are not reflected. OAuth discovery echoes an allow-listed origin and does not send credentials. |
| HTTPS | production + `x-forwarded-proto: http` | The request is redirected to HTTPS. Cloud Run terminates TLS. |
| Webhooks | `POST /api/webhooks/slack` | The Slack HMAC is checked against `SLACK_SIGNING_SECRET` and a 5-minute timestamp. Unsigned bodies are rejected. Local testing can set `SLACK_ALLOW_UNSIGNED=1`. |
| Debug | production | `/api/debug/pinecone-stats`, `/api/debug/pinecone-check`, and `/api/teams/debug-auth` return 404. 500 responses from the memory API say `Internal error` and omit the stack. Auth logs do not print headers. |
| Secrets | environment | `MEMORY_DATA_KEY` is read from the environment. Production boot prints a warning when it is missing. The key is not in the client. |
| Memory injection | `engine/inject.ts` | Retrieved profile and passages are wrapped in `<<<MEMORY>>>` … `<<<END MEMORY>>>`. The system text tells the model that block is untrusted data. |
| Agent keys | `POST /v3/keys`, `DELETE /v3/keys/:id` | A key resolves to its owner and can only see that owner's memory. Revoke with the delete route. Do not share one key across tenants. |

`GET /health` and `GET /v4/security` report `encryptionAtRest`, `rateLimiting`, `corsMode`, and `debugMode` without secrets.

Run the checks with `npm run security`. The privacy suite stays `npm run governance`.

## What is still limited

- Rate limits live in the process. Three Cloud Run instances each have their own counters.
- The audit log is append-only through the API and capped at 2,000 rows. The same process that stores memory also writes the JSON file, so a separate log sink is the next step if the file itself must be tamper-evident.
- Encryption at rest stays optional. Until `MEMORY_DATA_KEY` is set, `/health` reports `encryptionWarning`.
- Slack events stop until `SLACK_SIGNING_SECRET` is set on Cloud Run.
- `npm audit fix` (no `--force`) cleared the critical findings that had a compatible release. Ten high findings remain inside Firebase (`@grpc/grpc-js`), Bot Framework (`zod`), Azure MSAL (`uuid`), LangSmith, Google Cloud Storage, and Tailwind's PostCSS parser. Fixing those means downgrading Firebase or jumping major versions of the bot and cloud libraries, so they are left as exceptions.
