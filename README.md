# TB IoT S3 Dashboard

A Next.js dashboard for TB device telemetry, OTA files, and historical data discovery across:

- Hong Kong test
- Frankfurt production

The UI is driven by your TB object-model workbook, which has already been converted into a generated TypeScript mapping under `lib/generated/object-model.generated.ts`.

## What it does

- environment switch between Hong Kong test and Frankfurt production
- device switch for TB devices discovered from sampled S3 keys
- client-side device switching and cached detail queries for faster interaction
- device search, field search, and explicit start/end time filters
- object-model-driven current value cards with module, data type, unit, and access mode
- historical metric chart from sampled JSON payloads
- curve modal with hover tooltips and a draggable time-window selector
- payload inspector for raw device JSON recovered from live S3 objects
- bucket access map showing which prefixes are readable with the current IAM key
- CSV/JSON export endpoints for the filtered dashboard state
- OTA center for manifests and firmware artifacts
- OTA publish page with local draft outbox and optional direct S3 publish
- recent S3 object browser with signed or public URLs
- account registration, login, and super-admin user management
- server-side cost controls for Vercel-friendly operation
- local downloaded JSON mode for offline analysis without live S3 reads

## Cost and performance controls

- fixed S3 list budget per request
- fixed object fetch budget per request
- object size limit before parsing
- in-memory TTL cache for list and object fetch responses
- client-side state cache for device/detail/history requests
- representative-object sampling for per-device field counts
- server-side only AWS access
- chart downsampling before render

## Important AWS note

For local use or Vercel deployment, this app needs AWS programmatic credentials such as:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- optional `AWS_SESSION_TOKEN`

Console email and password are not enough for server-side S3 access from Vercel. If your company account uses IAM Identity Center or console-only login, create a scoped IAM user or temporary access keys for this dashboard.

## Environment variables

Copy `.env.example` and fill in your real bucket names and prefixes.

Current bucket clues recovered from your local AWS IoT documentation:

- Hong Kong telemetry: `tuobang-iot-data-report-dev`
- Hong Kong OTA: `tuobang-iot-ota-dev`
- Frankfurt telemetry: `tuobang-iot-data-report-prod`
- Frankfurt OTA: `tuobang-iot-ota-prod`

Observed prefix layout from your screenshots and live samples:

- Hong Kong telemetry: `iot-data/`, `iot-data-error/`, `athena/`
- Hong Kong OTA: `ac/`, `bms/`, `dc/`, `ems/`, `notify/`
- Frankfurt telemetry: `iot-data/`
- Frankfurt OTA: `ems/`, `notify/`

Observed payload formats:

- `iot-data/` objects are concatenated JSON documents without separators
- `iot-data-error/` objects contain error metadata plus a base64 `rawData` body that decodes back into device telemetry JSON

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=

AUTH_STORAGE_MODE=file
AUTH_STORE_SECRET=change-me-before-production
SEED_ADMIN_EMAIL=qirui.yan@yituishui.cn
SEED_ADMIN_PASSWORD=y11531752
BLOB_READ_WRITE_TOKEN=

AWS_IOT_TEST_REGION=ap-east-1
AWS_IOT_TEST_BUCKETS=tuobang-iot-data-report-dev
AWS_IOT_TEST_PREFIX_HINTS=iot-data/
AWS_IOT_TEST_PUBLIC_BASE_URL=

AWS_IOT_PROD_REGION=eu-central-1
AWS_IOT_PROD_BUCKETS=tuobang-iot-data-report-prod,tuobang-iot-ota-prod
AWS_IOT_PROD_PREFIX_HINTS=iot-data/,notify/,ems/
AWS_IOT_PROD_PUBLIC_BASE_URL=

LOCAL_IOT_DATA_ROOT=.local-data/iot-downloads
LOCAL_IOT_TEST_DATA_DIR=
LOCAL_IOT_PROD_DATA_DIR=
```

## Regenerate the object model

If the workbook changes:

```bash
npm run generate:object-model
```

Or point to another workbook path:

```powershell
$env:OBJECT_MODEL_XLSX_PATH="D:\download\物模型_2026_1_6(1).xlsx"
npm run generate:object-model
```

## Local use

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default super-admin seed:

- account: `qirui.yan@yituishui.cn`
- password: `y11531752`

Change both values in `.env.local` before exposing the app outside your team.

## Live S3 mode

The dashboard now defaults to live S3 reads. For the current TB device view, the main source is:

- `s3://tuobang-iot-data-report-dev/iot-data/`

Recommended:

- keep `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env.local`
- start the app with `npm run dev` or `npm run local:open`
- the homepage will read `iot-data/` directly and map fields to the Chinese object model

## Local downloaded JSON fallback

If live S3 is unavailable, you can still analyze manually downloaded JSON objects locally.

Recommended folder layout:

```text
.local-data/iot-downloads/
  hk-test/
    iot-data/2025-11-25/TB90e5b1cd3af4/...
    iot-data-error/...
  de-prod/
    iot-data/...
```

Notes:

- keep the original `iot-data/` path structure whenever possible
- the dashboard will only switch to local files when live S3 is unavailable or returns no usable objects
- if file names do not include the device ID, detection may still work from JSON contents, but keeping the original path is more reliable
- this mode is ideal when someone downloads the S3 JSON files manually from the web console first

For a Windows-friendly local launcher, you can also:

1. Double-click `open-local.cmd`
2. Or run `npm run local:open`

The launcher will:

- create `.env.local` from `.env.example` if it does not exist yet
- install dependencies if `node_modules` is missing
- start the local Next.js server in a new PowerShell window
- open your browser automatically

## Local OTA drafts

When you use the OTA publish page in local draft mode, generated manifest and notify JSON files are saved under:

- `.local-data/ota-notify`

This folder is git-ignored and intended for local operations only.

## Deploy to Vercel

1. Push this project to GitHub.
2. Import it into Vercel.
3. Add the AWS environment variables from `.env.example`.
4. For account persistence on Vercel, set:
   - `AUTH_STORAGE_MODE=blob`
   - `AUTH_STORE_SECRET`
   - `BLOB_READ_WRITE_TOKEN`
   - `SEED_ADMIN_EMAIL`
   - `SEED_ADMIN_PASSWORD`
5. Deploy.

The repository is already linked to a Vercel project through `.vercel/project.json`. If the CLI on your machine is logged into the same team, you can deploy with:

```bash
npx vercel --prod
```

If you skip `BLOB_READ_WRITE_TOKEN`, the app will fall back to `/tmp` on Vercel. That is usable for smoke tests, but user and session data will not survive function restarts.
