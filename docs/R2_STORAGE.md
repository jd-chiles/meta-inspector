# Private R2 media storage

The application uses Cloudflare R2's private S3-compatible endpoint for staged video uploads and server-derived evidence JPEGs. Configure the following **server-only** environment variables in the managed application runtime:

| Variable | Required | Value |
|---|---:|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | 32-character Cloudflare account ID (hexadecimal). |
| `R2_BUCKET_NAME` | Yes | Existing private R2 bucket name. |
| `R2_ACCESS_KEY_ID` | Yes | Access key ID for a bucket-scoped R2 API token. |
| `R2_SECRET_ACCESS_KEY` | Yes | Secret access key paired with that token. |
| `R2_ENDPOINT` | No | Defaults to `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com`. When set, it must be that exact HTTPS account endpoint; custom hosts, paths, ports, and redirects are rejected. |

Use a token scoped to object read and write for this bucket. Do not grant bucket administration to the application token. These variables must never use a `NEXT_PUBLIC_` prefix, enter browser code, or appear in logs. The adapter does not provision buckets, configure Cloudflare, or deploy infrastructure.

## Upload and object contract

The server creates an unguessable `media/<uuid>.mp4` or `media/<uuid>.mov` key and a 15-minute, key-scoped presigned PUT. The signature binds the exact MP4 or QuickTime MOV MIME type, expected byte length (1 through 60 MiB), and `If-None-Match: *`. The latter makes the key write-once, preventing a still-valid URL from replacing bytes after a worker has bound an analysis to the key. The client must upload the same `File`/`Blob` whose byte length was used to create the intent; browser code must not set the forbidden `Content-Length` request header itself. The user agent supplies it. The job-start route compares R2 HEAD size and MIME against the intent, and the worker hashes bytes downloaded from R2 before processing. A browser-reported hash is only an expected identity and is never proof of the stored bytes.

The server creates `evidence/<uuid>.jpg` keys for verified candidate stills. Server writes check the supplied SHA-256 against actual bytes, enforce the 512 KiB frame bound, and are also write-once. Job rows should store opaque keys and sanitized metadata only, not presigned URLs or image/video bytes. Worker reads, HEAD checks, and deletion use server-side signed requests. Evidence reads may use the authenticated application proxy or a short-lived (up to five-minute) signed GET; neither is a public object URL. Never accept a client-provided host or arbitrary object path for a storage request.

The upload URL signs these HTTP request values (MIME is `video/mp4` or `video/quicktime` for the validated object extension):

```text
PUT <presigned R2 object URL>
Content-Type: video/mp4 (or video/quicktime for MOV)
If-None-Match: *
Content-Length: <same byte count as upload intent; set by the browser>
```

Signed URLs are bearer capabilities. Keep them out of analytics, logs, persistent job state, and error messages. A failed or ambiguous upload should be checked through the job-start HEAD validation; a retry should request a fresh intent/key.

## Bucket CORS and privacy

Keep the bucket private, disable `r2.dev`, and do not attach a public custom domain. Configure bucket CORS with only the deployed application origins (add staging separately only if needed). For each exact origin, allow `PUT` and `GET`, allow request headers `content-type` and `if-none-match`, and expose no response headers unless an independently verified browser requirement emerges. The browser does not need direct HEAD, DELETE, or list permission. Do not use wildcard origins.

Example policy shape (replace the origin with the exact HTTPS application origin before applying it):

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://app.example.org"],
        "methods": ["PUT", "GET"],
        "headers": ["content-type", "if-none-match"]
      },
      "exposeHeaders": [],
      "maxAgeSeconds": 300
    }
  ]
}
```

For browser CORS, the user agent controls `Content-Length`; it is part of the signed upload request but must not be added by application JavaScript or to `Access-Control-Request-Headers` manually. An expired presigned URL may not carry R2 CORS response headers, so browser clients should show a generic retry message rather than attempting to display provider error XML.

## Retention and cleanup

Application cancellation, expiry cleanup, and local session deletion should delete associated `media/` and `evidence/` keys through the authenticated server adapter. Keep the original uploaded source video in private R2 until the worker has completed required processing and persisted the verified evidence and job result, then delete it. Retain only the bounded derived evidence required for review. Cancellation, expiry, and session deletion must delete linked media/evidence objects and database records idempotently; a durable tombstone blocks new work during deletion. Configure a bucket lifecycle expiration as a backstop for orphaned objects, with shorter retention for `media/` than `evidence/`. The exact evidence retention window must follow the product's approved retention policy; lifecycle expiration is not a substitute for per-session deletion. No bucket lifecycle or CORS policy has been provisioned by this change.

R2 is the source of truth for uploaded originals and evidence during cloud processing/review. The browser holds only transient capture/preview state and has no offline session recovery. The server database is the source of truth for session and job metadata. Local cache clearing does not imply deletion of cloud records, provider-side processing, or downloaded exports; explicit session deletion must use the authenticated tombstone/cleanup path.

References: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [R2 CORS configuration](https://developers.cloudflare.com/r2/buckets/cors/), and [R2 conditional writes](https://developers.cloudflare.com/r2/reference/consistency/).


## Provisioning status

This document describes the intended adapter contract, not provisioned infrastructure. Bucket creation, bucket-scoped credentials, exact-origin CORS, lifecycle expiration, database URL, worker wake/recovery, monitoring, and quota controls must be configured and verified before production launch. Free R2 allowances are not a guaranteed $0 service.
