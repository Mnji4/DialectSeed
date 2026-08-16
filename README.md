# DialectSeed

DialectSeed started as a small project to record my own hometown dialect, Yangjiang Cantonese.

The more I worked on it, the less sense it made to keep the project tied to one place. Many local speech varieties face the same problem: fewer young people speak them fluently, recordings are scattered across social media, and the material that does exist often lacks transcripts, speaker metadata, provenance, or clear permission for research and model training.

DialectSeed is an open-source framework for communities to build structured speech corpora for their own local languages, dialects, and speech varieties.

The basic workflow is intentionally simple: choose a speech variety, read a prompt, record how you would naturally say it, correct the transcript, and submit the recording with explicit consent settings. Moderators can review submissions, and approved recordings with training permission can later be exported for ASR or TTS experiments.

Yangjiang Cantonese remains in the project as the first seed dataset. It is an example, not a hard-coded system assumption.

## What it can do

- Collect multiple dialects, local languages, or speech varieties in one deployment.
- Let contributors request a new variety when theirs is missing.
- Store the reference prompt separately from the actual spoken transcript.
- Assign an anonymous browser-local `speaker_id` so train/validation/test splits can be speaker-disjoint.
- Record archival consent and model-training consent separately.
- Moderate, approve, reject, restore, and delete recordings.
- Export ASR/TTS-ready manifests from approved, explicitly licensed recordings.
- Download datasets as `metadata.jsonl + audio/` with stable speaker-based splits.

## What it is not

DialectSeed is corpus collection infrastructure. It is not a pretrained dialect ASR/TTS model, and it is not a complete linguistic fieldwork suite.

Crowdsourced browser recordings are useful, but they are not automatically high-quality TTS data. TTS normally needs tighter control over recording conditions, audio consistency, text normalization, and speaker coverage. DialectSeed keeps the original uploaded audio and metadata intact so downstream preprocessing can be explicit and reproducible instead of hidden inside the collection step.

## Data model

The core structure is deliberately small:

```text
variety  ->  prompt / text  ->  recording
```

### `varieties`

A `variety` is a practical collection unit. The project does not try to settle whether something should be called a language, dialect, topolect, or local variety.

```text
id
slug
name
language_tag
region
description
status          pending / active / archived
created_by
created_at
```

### `texts`

Prompts keep the reference text separate from the local-language form.

```text
id
variety_id
content
reference_text
local_text
source          seed / user
prompt_key
status
created_at
```

The reference text is there to help the contributor understand the intended meaning. The transcript saved with a recording is the label that matters for supervised ASR/TTS training.

### `recordings`

Audio files live in R2. D1 stores their metadata and consent state.

```text
id
text_id
variety_id
r2_key
mime_type
size_bytes
duration_ms
speaker_id
speaker_label
consent_archive
consent_training
consent_version
reference_text_snapshot
transcript_text_snapshot
status
created_at
```

A recording enters the training export only when all of the following are true:

1. its moderation status is `approved`;
2. the contributor explicitly granted training permission;
3. a non-empty spoken transcript is available.

Old recordings migrated from the original Yangjiang-only version are **not** automatically granted model-training permission. Their `consent_training` value remains `0` unless consent is collected separately.

## Stack

```text
React + TypeScript + Vite     collection UI and admin UI
Cloudflare Pages              frontend hosting
Cloudflare Workers            API
Cloudflare D1                 metadata
Cloudflare R2                 audio objects
```

Main files:

```text
src/App.tsx                    contributor interface
src/AdminPage.tsx              moderation and export interface
worker/src/index.ts            Worker API
schema.sql                     fresh database schema
migrations/0002_multivariety.sql
                               migration from the original single-variety schema
scripts/export-dataset.mjs     dataset downloader/exporter
public/_worker.js              same-origin Pages -> Worker proxy
```

## Run locally

Node.js 20+ is recommended.

```bash
npm install
npm run dev
```

Run the Worker in another terminal:

```bash
npm run dev:worker
```

The frontend uses `http://localhost:8787` as its development API by default. Set `VITE_API_BASE_URL` to use another endpoint.

Initialize a local D1 database:

```bash
npm run db:migrate:local
```

Build the frontend:

```bash
npm run build
```

## Deploy to Cloudflare

Create a D1 database, an R2 bucket, and a Pages project, then replace the placeholders in `wrangler.toml` with your own resource IDs.

Initialize the remote database:

```bash
npm run db:migrate:remote
```

Set an admin token:

```bash
printf '%s' 'your-admin-token' | npx wrangler secret put ADMIN_TOKEN --config wrangler.toml
```

Optionally set a random salt if you want irreversible IP hashes for basic abuse analysis:

```bash
printf '%s' 'a-random-secret' | npx wrangler secret put IP_HASH_SALT --config wrangler.toml
```

If `IP_HASH_SALT` is not configured, DialectSeed does not store IP hashes.

Deploy the API:

```bash
npm run deploy:worker
```

Set the Pages environment variable `API_HOST` to the Worker hostname, then build and deploy the frontend:

```bash
npm run build
npm run deploy:pages
```

`public/_worker.js` proxies `/api/*` requests to the Worker so the browser can stay on the Pages origin.

## Upgrade from the original Yangjiang-only version

Do not overwrite an existing v1 database with `schema.sql`. Back it up and run the migration once:

```bash
npm run db:migrate:v2:remote
```

The migration creates the variety layer, assigns the existing corpus to Yangjiang Cantonese, adds speaker and consent fields, and keeps training permission disabled for historical recordings.

## Export data for ASR or TTS

The admin page can download a training manifest directly.

To download both metadata and audio:

```bash
node scripts/export-dataset.mjs \
  --api https://your-pages-domain.example \
  --token "$ADMIN_TOKEN" \
  --task asr \
  --out ./dataset-asr
```

Export one variety only:

```bash
node scripts/export-dataset.mjs \
  --api https://your-pages-domain.example \
  --token "$ADMIN_TOKEN" \
  --variety 1 \
  --task tts \
  --out ./dataset-tts
```

You can use `DIALECTSEED_API_URL` and `DIALECTSEED_ADMIN_TOKEN` instead of command-line values.

When there are fewer than 10 distinct speakers, the exporter keeps all samples in the training split rather than pretending that a tiny validation/test split is statistically meaningful.

## Consent and data governance

Voice data can reveal identity, age, region, health characteristics, and other personal information. DialectSeed therefore treats "preserve this recording" and "use this recording to train a model" as separate decisions.

This repository provides a technical consent trail, not a universal legal policy. Anyone operating a public deployment still needs appropriate data licensing, withdrawal procedures, privacy notices, rules for minors, and publication policies for their jurisdiction and community.

## Why "DialectSeed"?

One recording cannot preserve a language.

But a small, well-described, reusable corpus can be a seed: something a community can grow into better documentation, better datasets, and eventually better speech technology for languages that are usually ignored by mainstream models.

This project started with Yangjiang Cantonese. The goal is for it not to end there.

## License

Code is released under the [MIT License](LICENSE).

User-contributed recordings and text require their own dataset license. The code license does **not** automatically license collected speech data.
