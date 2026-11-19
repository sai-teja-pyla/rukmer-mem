# Memory store lockdown

Operator steps for the production memory bucket and the encryption key. Run them with a project owner (or equivalent) on GCP project `rukmer-saas`. The application does not run these commands. Tests do not call `gcloud`.

The engine store bucket is whatever `MEMORY_GCS_BUCKET` is set to. The process does not fall back to a built-in bucket name. `MEMORY_GCS_OBJECT` defaults to `engine/engine.json` only after the bucket name is set. File blobs written by the engine use `engine/files/<id>` in that same bucket.

Legacy client uploads use `UPLOAD_GCS_BUCKET`, or `rukmer-saas-data` when that variable is unset. New objects are stored at `uploads/<uid>/`. The list route only reads that prefix. A read URL is a V4 signed URL that lasts 10 minutes, and only for an object under the signed-in user's prefix. The routes do not return a public object URL. There is no in-repo caller of `/api/storage` today.

## A. Lock the bucket

Do this before deploying the application change. A missing binding on `remove-iam-policy-binding` is expected when that member and role are not present. Continue until both verification curls return 401 or 403.

Google's edge may keep serving a previously public object for up to an hour because the old metadata was `cache-control: public, max-age=3600`. The cache update below is part of the same change. Re-check after that window.

```bash
# 1. Inspect current bindings. Look for allUsers and allAuthenticatedUsers
#    (objectViewer, legacyObjectReader, legacyBucketReader, or anything else public).
gcloud storage buckets get-iam-policy gs://rukmer-saas-data

# 2. Remove every public binding you found. Start with these; repeat for
#    allAuthenticatedUsers and any other public role the policy shows.
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allUsers --role=roles/storage.objectViewer
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allUsers --role=roles/storage.legacyObjectReader
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allUsers --role=roles/storage.legacyBucketReader
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allAuthenticatedUsers --role=roles/storage.objectViewer
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allAuthenticatedUsers --role=roles/storage.legacyObjectReader
gcloud storage buckets remove-iam-policy-binding gs://rukmer-saas-data --member=allAuthenticatedUsers --role=roles/storage.legacyBucketReader

# 3. Enforce Public Access Prevention and uniform bucket-level access
#    so object ACLs cannot re-open the bucket.
gcloud storage buckets update gs://rukmer-saas-data --public-access-prevention --uniform-bucket-level-access

# 4. Stop edge caches from serving the old public copy.
gcloud storage objects update gs://rukmer-saas-data/engine/engine.json --cache-control="private, no-store"
gcloud storage objects update "gs://rukmer-saas-data/engine/**" --cache-control="private, no-store"

# 5. Least privilege for the app. Grant the Cloud Run runtime service
#    account of rukmer-saas-service (us-central1, project rukmer-saas)
#    roles/storage.objectUser on this bucket only. Do not grant
#    roles/storage.admin or a project-wide storage role.
gcloud run services describe rukmer-saas-service --region us-central1 --format='value(spec.template.spec.serviceAccountName)'
# If that value is empty, the runtime account is the project default Compute Engine service account.
# gcloud storage buckets add-iam-policy-binding gs://rukmer-saas-data \
#   --member=serviceAccount:RUNTIME_SA_EMAIL \
#   --role=roles/storage.objectUser

# 6. Verify while unauthenticated. Expect 401 or 403, never 200.
#    HEAD only. Do not download the object body.
curl -sI https://storage.googleapis.com/rukmer-saas-data/engine/engine.json
curl -s -o /dev/null -w "%{http_code}\n" "https://storage.googleapis.com/storage/v1/b/rukmer-saas-data/o?maxResults=1&fields=kind"
```

Repeat step 2 for every public member and role the policy still shows. Production boot also sends those two unauthenticated checks. A 200 fails boot. A 401, 403, or a network error allows boot. The check does not read the object body, and `/health` does not name the bucket or the object.

New engine writes set `cacheControl: private, no-store`. They do not set a public ACL.

## Encryption key

Generate a 64-hex key. Back it up offline, outside the repo and outside the bucket. Losing the key loses the store.

```bash
openssl rand -hex 32

# Store it in Secret Manager, not a plain Cloud Run env var.
gcloud secrets create MEMORY_DATA_KEY --replication-policy=automatic
# Then add the value, for example:
# gcloud secrets versions add MEMORY_DATA_KEY --data-file=-
```

Do not put the key in `--update-env-vars`. `cloudbuild.yaml` mounts it with `--update-secrets=MEMORY_DATA_KEY=MEMORY_DATA_KEY:latest` (the same binding as `--set-secrets=MEMORY_DATA_KEY=MEMORY_DATA_KEY:latest` on a service that has no other secrets). `--update-secrets` leaves any other mounted secrets in place.

Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` on that secret only:

```bash
gcloud secrets add-iam-policy-binding MEMORY_DATA_KEY \
  --member=serviceAccount:RUNTIME_SA_EMAIL \
  --role=roles/secretmanager.secretAccessor
```

Set `MEMORY_GCS_BUCKET` to the private bucket name as a normal environment variable. `cloudbuild.yaml` passes `_MEMORY_GCS_BUCKET` (currently `rukmer-saas-data` after the lockdown above). Point it at a dedicated bucket such as `rukmer-engine-private` later without a code change, and grant `roles/storage.objectUser` on that bucket only.

The Node client uses Application Default Credentials in production (`new Storage()` for the engine, `new Storage(storageConfig)` for legacy uploads). Do not add a key file on Cloud Run.

Production boot refuses a missing `MEMORY_DATA_KEY`, a value that is not 64 hex characters, and a missing `MEMORY_GCS_BUCKET`. Surrounding whitespace is ignored so a trailing newline from Secret Manager still matches. A passphrase is not hashed in production. Local development may still hash a non-hex value.

`MEMORY_DATA_KEY` is the current key. `MEMORY_DATA_KEY_PREVIOUS` is decrypt-only. Saves always use the current key and write an envelope `{ enc: "v1", kid, iv, tag, data }`. `kid` is the first 8 hex characters of SHA-256 of the key. Reads try the current key, then the previous key. On the first successful boot, a store that was unencrypted, or that opened with the previous key, is rewritten under the current key with `cacheControl: private, no-store`. The process does not log the store contents.

After deploy:

```bash
curl -sI https://storage.googleapis.com/rukmer-saas-data/engine/engine.json
curl -s -o /dev/null -w "%{http_code}\n" "https://storage.googleapis.com/storage/v1/b/rukmer-saas-data/o?maxResults=1&fields=kind"
curl -s https://app.rukmer.com/health
```

The two storage checks return 401 or 403. `/health` returns 200 with `"encryptionAtRest": true` and without an encryption-warning string, a store location, or a provider list. The service still has to start, load memories, and persist a write. Confirm that from the Cloud Run logs and the app, not by downloading the object.

## D. Follow-ups

These checks are not in the application repo.

1. Turn on Cloud Audit Logs Data Access for Cloud Storage on project `rukmer-saas` if they are not already on (IAM > Audit Logs, or `gcloud projects get-iam-policy` and the Data Access config). Public object reads often never generate these logs when the config was off. Check anyway.

2. In Logs Explorer, or in the bucket's usage logs if a log bucket was configured, search for anonymous or `allUsers` reads of `gs://rukmer-saas-data/engine/engine.json` and `engine/files/*` since the bucket was public. It was already public when audited at about 12:49 AM America/New_York on 18 Nov 2026. The object's last-modified time at that moment was 12:46 AM America/New_York. Use that to judge whether user data was downloaded and whether users must be notified (GDPR 72-hour window, US state laws). Get counsel involved if any customer or EU/CA data was in the store.

3. Rotate secrets that may have lived in the store: connector and third-party API keys, unused user API keys, and raw OAuth authorization codes (they are stored unhashed in `EngineState.oauthCodes`). Key hashes are not a practical cracking target. Treat any authorization code that was still valid while the object was public as compromised.

4. Review Firebase Storage security rules in the GCP/Firebase console. They are not in this repo. `firebase.json` only wires Firestore rules and Hosting rewrites.
