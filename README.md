# DialectSeed

**An open-source pipeline for collecting regional speech and building low-resource ASR/TTS systems.**

Commercial speech systems tend to prioritize languages and accents with large user bases, abundant data, and clear deployment demand. Regional dialects often have none of those advantages. The result is not only cultural loss: people who rely on local speech can also be excluded from modern digital services.

This is personal for me. My grandmother cannot type and does not speak standard Mandarin comfortably. A voice interface should be the most natural way for her to use a digital service, yet the speech technology around her is built for a language variety she does not normally use.

DialectSeed started as a small project to record my hometown dialect, Yangjiang Cantonese. It is now being generalized into an open-source, end-to-end workflow that other communities can reuse for their own underrepresented local languages and speech varieties.

The goal is simple: **make it cheap and reproducible to go from community recordings to a clean, consented dataset and then to a small dialect-adapted speech model.**

> The training recipes are implemented, but the project does not yet claim a finished production-quality dialect ASR or TTS model. Model experiments are still in active development.

## The pipeline

```text
Community contributors
        |
        v
Browser recording + transcript correction
        |
        v
Consent + anonymous speaker metadata
        |
        v
Moderation and quality control
        |
        v
D1 metadata + R2 audio storage
        |
        v
Speaker-disjoint dataset export
        |
        +-----------------------+
        |                       |
        v                       v
 Qwen3-ASR-0.6B          VoxCPM1.5
   ASR fine-tuning         TTS LoRA
        |                       |
        +-----------+-----------+
                    |
                    v
          Local speech technology
```

Yangjiang Cantonese remains the first seed variety, but it is only an example. The data model and collection workflow are designed to support many dialects, local languages, and speech varieties in the same deployment.

## What DialectSeed provides

### Community data collection

- Record speech directly in the browser.
- Collect multiple speech varieties in one deployment.
- Let contributors request a variety that does not exist yet.
- Store the reference prompt separately from what the speaker actually said.
- Allow the contributor to correct the spoken transcript before submission.
- Assign an anonymous browser-local `speaker_id` for speaker-aware dataset splitting.

### Consent and moderation

- Separate permission to **preserve a recording** from permission to **use it for model training**.
- Review recordings before they enter the training corpus.
- Approve, reject, restore, or delete submissions.
- Preserve a consent version and transcript snapshot with every recording.
- Never automatically grant training permission to recordings migrated from the old Yangjiang-only version.

### Dataset export

- Export only recordings that are approved and explicitly licensed for training.
- Download `metadata.jsonl + audio/` datasets.
- Keep train/validation/test splits speaker-disjoint when the corpus has enough speakers.
- Convert browser audio into model-specific WAV formats.
- Produce manifests directly compatible with the selected upstream trainers.

### Low-resource model training

The repository includes a lightweight training layer in [`training/`](training/) rather than maintaining forks of large upstream model repositories.

Current default recipes:

| Task | Model | Size | Strategy | Why |
| --- | --- | ---: | --- | --- |
| ASR | Qwen3-ASR-0.6B | 0.6B | supervised fine-tuning | strong pretrained coverage for Cantonese and Chinese dialects |
| TTS | VoxCPM1.5 | <1B | LoRA | official parameter-efficient fine-tuning and same-speaker reference audio support |

For small dialect corpora, model size is not the main variable. A strong pretrained speech model, clean transcripts, conservative fine-tuning, and speaker-safe evaluation matter more than simply choosing the smallest network available.

The project therefore starts with sub-1B models because they are practical to iterate on, cheap enough for repeated experiments, and already have useful Chinese/Cantonese speech priors.

Other useful baselines include Whisper, SenseVoice, CosyVoice, F5-TTS, and GPT-SoVITS. The reasoning and training commands are documented in [`training/README.md`](training/README.md).

## Repository structure

```text
src/
  App.tsx                     contributor recording interface
  AdminPage.tsx               moderation and export interface

worker/src/index.ts           Cloudflare Worker API
schema.sql                    current D1 schema
migrations/                   database migrations
scripts/export-dataset.mjs    approved dataset downloader

training/
  prepare.py                  model-specific data preparation
  asr/qwen3_asr/              ASR setup, training and CER evaluation
  tts/voxcpm/                 VoxCPM1.5 LoRA setup and training

public/_worker.js             Pages -> Worker same-origin proxy
wrangler.toml                 Cloudflare configuration
```

## Data model

The collection model is intentionally small:

```text
variety  ->  prompt/text  ->  recording
```

A `variety` represents a practical collection unit. DialectSeed does not try to settle whether a community should call its speech a language, dialect, topolect, accent, or local variety.

A recording stores the information needed for later corpus work: its variety, source prompt, actual transcript snapshot, anonymous speaker ID, duration, storage key, moderation state, and consent state. See [`schema.sql`](schema.sql) for the complete schema.

A recording can enter the training export only when:

1. its moderation status is `approved`;
2. the contributor explicitly granted model-training permission;
3. the spoken transcript is non-empty.

## Quick start

Node.js 20+ is recommended.

```bash
npm install
npm run dev
```

Run the API in another terminal:

```bash
npm run dev:worker
```

Initialize a local D1 database:

```bash
npm run db:migrate:local
```

The frontend uses `http://localhost:8787` as the development API by default. Set `VITE_API_BASE_URL` to use another endpoint.

## Export a training dataset

From a deployed DialectSeed instance:

```bash
node scripts/export-dataset.mjs \
  --api https://your-dialectseed.example \
  --token "$ADMIN_TOKEN" \
  --task asr \
  --out ./dataset-asr
```

For TTS:

```bash
node scripts/export-dataset.mjs \
  --api https://your-dialectseed.example \
  --token "$ADMIN_TOKEN" \
  --task tts \
  --out ./dataset-tts
```

Restrict an export to one variety with `--variety <id>`.

When there are fewer than 10 distinct speakers, the exporter keeps all samples in the training split instead of constructing a statistically meaningless tiny validation/test split.

## Train ASR

Prepare the exported dataset:

```bash
python training/prepare.py \
  --format qwen3-asr \
  --input dataset-asr/metadata.jsonl \
  --output training-data/qwen3-asr
```

Then fine-tune Qwen3-ASR-0.6B:

```bash
bash training/asr/qwen3_asr/train.sh \
  training-data/qwen3-asr \
  runs/qwen3-asr-0.6b
```

Evaluate character error rate on held-out speakers:

```bash
python training/asr/qwen3_asr/evaluate.py \
  --model runs/qwen3-asr-0.6b/checkpoint-XXX \
  --manifest training-data/qwen3-asr/test.jsonl
```

The important comparison is not training loss. It is the base model versus the fine-tuned model on speakers that were never seen during training.

## Train TTS

Prepare the TTS data:

```bash
python training/prepare.py \
  --format voxcpm \
  --input dataset-tts/metadata.jsonl \
  --output training-data/voxcpm
```

Then run VoxCPM1.5 LoRA fine-tuning:

```bash
bash training/tts/voxcpm/train_lora.sh \
  training-data/voxcpm \
  runs/voxcpm1.5-lora
```

The converter can pair a recording with another clip from the same speaker as `ref_audio` without crossing dataset splits. This uses the anonymous speaker identity collected by DialectSeed instead of treating every recording as an unrelated sample.

See [`training/README.md`](training/README.md) for model selection, environment setup, hyperparameters, and baseline recommendations.

## Deploy to Cloudflare

DialectSeed currently uses:

```text
React + TypeScript + Vite     web interface
Cloudflare Pages              frontend hosting
Cloudflare Workers            API
Cloudflare D1                 metadata
Cloudflare R2                 audio storage
```

Create a D1 database, an R2 bucket, and a Pages project, then replace the placeholders in `wrangler.toml`.

Initialize the remote database:

```bash
npm run db:migrate:remote
```

Set the admin token:

```bash
printf '%s' 'your-admin-token' | \
  npx wrangler secret put ADMIN_TOKEN --config wrangler.toml
```

Optionally configure `IP_HASH_SALT` for irreversible IP hashes used in basic abuse analysis. If it is not configured, DialectSeed does not store IP hashes.

Deploy the Worker and frontend:

```bash
npm run deploy:worker
npm run build
npm run deploy:pages
```

Set the Pages environment variable `API_HOST` to the Worker hostname.

## Upgrading the original Yangjiang-only project

Do not overwrite a v1 database with `schema.sql`. Back it up and run:

```bash
npm run db:migrate:v2:remote
```

The migration moves the old corpus under the Yangjiang Cantonese variety and adds speaker and consent fields. Historical recordings keep `consent_training = 0`; an infrastructure migration must not silently expand the permission contributors originally gave.

## Current limitations

DialectSeed is not claiming that crowdsourced browser audio is automatically high-quality speech-model data.

TTS in particular is sensitive to transcript mismatch, clipping, room acoustics, background noise, long silence, inconsistent speaking style, and speaker imbalance. The project keeps preprocessing explicit because silently applying aggressive cleanup during collection makes the resulting corpus harder to audit and reproduce.

The training code is also a starting point, not a benchmark result. A useful next milestone is to publish reproducible base-model versus fine-tuned results on a frozen, speaker-disjoint Yangjiang Cantonese test set.

## Consent and data governance

Voice is biometric and personal data. It can reveal identity, age, region, health characteristics, and other attributes.

DialectSeed therefore treats archival consent and model-training consent as different decisions. The repository provides the technical mechanism for recording that choice, but a public deployment still needs an appropriate dataset license, privacy notice, withdrawal process, policy for minors, and community-specific publication rules.

## Why "DialectSeed"?

One recording cannot preserve a language.

But a small, well-described and reusable corpus can be a seed: something a community can grow into better documentation, better datasets, and eventually better speech technology for languages that mainstream products do not serve well.

This project started with Yangjiang Cantonese. The point is for the process to be reusable somewhere else.

## License

Code is released under the [MIT License](LICENSE).

User-contributed recordings and text require their own dataset license. The code license does **not** automatically license collected speech data.
