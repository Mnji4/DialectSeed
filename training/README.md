# DialectSeed training

DialectSeed keeps data collection separate from model training. The collection app exports reviewed, explicitly training-consented recordings; this directory turns those exports into reproducible ASR and TTS experiments.

The default recipes intentionally stay below one billion parameters. This is not because parameter count alone determines low-resource performance. For small dialect corpora, the more important factors are a strong pretrained speech model, good domain/language coverage, clean transcripts, speaker-safe splits, and conservative fine-tuning.

## Default models

### ASR: Qwen3-ASR-0.6B

Default model: `Qwen/Qwen3-ASR-0.6B`

Why it is the default:

- 0.6B parameters.
- Native support for Cantonese and many Chinese dialects/accents.
- Official supervised fine-tuning code.
- Streaming and offline inference use the same model family.
- Apache-2.0 upstream code/license.

Upstream: https://github.com/QwenLM/Qwen3-ASR

The official fine-tuner is full supervised fine-tuning rather than LoRA. With a small corpus, use a low learning rate, a held-out speaker-disjoint validation set, and stop when validation loss stops improving. Do not assume more epochs are better.

### TTS: VoxCPM 1.5

Default model: `openbmb/VoxCPM1.5`

Why it is the default:

- Roughly 0.75B parameters and below the 1B project target.
- Official LoRA and full fine-tuning support.
- LoRA is explicitly recommended upstream for small customization datasets.
- A training sample can include `ref_audio` from the same speaker, which maps naturally to DialectSeed's anonymous `speaker_id`.
- Apache-2.0 upstream model/code license.

Upstream: https://github.com/OpenBMB/VoxCPM

For a community dialect corpus, the first TTS experiment should be LoRA, not a full fine-tune. A multi-speaker crowdsourced corpus is also not equivalent to studio TTS data: noisy clips, transcript mismatches, and long trailing silence can damage synthesis much more than adding a few more hours helps.

## Other models worth benchmarking

- **Whisper small / medium / turbo**: 244M / 769M / ~0.8B. Very mature multilingual ASR baselines. Keep one as a baseline, but Qwen3-ASR is a better first target for this project because its current pretrained coverage explicitly includes Cantonese and Chinese dialects.
- **SenseVoiceSmall**: a compact multilingual ASR option with Chinese/Cantonese support. Useful when inference cost matters more than having the newest ASR stack.
- **Fun-CosyVoice3-0.5B**: a strong 0.5B TTS model with broad Chinese dialect coverage and official training recipes. It is an important zero-shot/finetuning baseline, but VoxCPM currently exposes a cleaner first-party LoRA workflow for small custom datasets.
- **F5-TTS (~0.3B)**: simple architecture and official fine-tuning support. Its public pretrained weights use a non-commercial license, so it is not the default for a reusable competition/open-source project.
- **GPT-SoVITS**: extremely practical for few-shot speaker adaptation and supports Cantonese, but its training pipeline is more specialized around voice cloning than the corpus-level, multi-speaker workflow DialectSeed is building.

## 1. Export data from DialectSeed

ASR:

```bash
node scripts/export-dataset.mjs \
  --api https://your-dialectseed.example \
  --token "$ADMIN_TOKEN" \
  --task asr \
  --out ./dataset-asr
```

TTS:

```bash
node scripts/export-dataset.mjs \
  --api https://your-dialectseed.example \
  --token "$ADMIN_TOKEN" \
  --task tts \
  --out ./dataset-tts
```

The exporter already assigns speaker-disjoint `train`, `validation`, and `test` splits when enough speakers are available.

## 2. Prepare model-specific manifests

The preparation script converts browser audio to mono WAV, keeps the split boundaries, and writes the format expected by each upstream trainer.

Qwen3-ASR:

```bash
python training/prepare.py \
  --format qwen3-asr \
  --input dataset-asr/metadata.jsonl \
  --output training-data/qwen3-asr
```

VoxCPM 1.5:

```bash
python training/prepare.py \
  --format voxcpm \
  --input dataset-tts/metadata.jsonl \
  --output training-data/voxcpm
```

`ffmpeg` must be installed. Qwen3-ASR audio is normalized to 16 kHz mono WAV. VoxCPM 1.5 audio is normalized to 44.1 kHz mono WAV.

For VoxCPM, the converter deterministically gives about 40% of eligible samples a `ref_audio` clip from another recording by the same speaker. Reference clips never cross train/validation/test boundaries.

## 3. Train ASR

Use a separate Python environment for ASR:

```bash
bash training/asr/qwen3_asr/train.sh training-data/qwen3-asr runs/qwen3-asr-0.6b
```

Defaults are deliberately conservative for a small corpus. Override them with environment variables:

```bash
BATCH_SIZE=1 \
GRAD_ACC=16 \
LR=5e-6 \
EPOCHS=2 \
bash training/asr/qwen3_asr/train.sh \
  training-data/qwen3-asr \
  runs/qwen3-asr-0.6b
```

Evaluate CER on the held-out test set:

```bash
python training/asr/qwen3_asr/evaluate.py \
  --model runs/qwen3-asr-0.6b/checkpoint-XXX \
  --manifest training-data/qwen3-asr/test.jsonl \
  --output runs/qwen3-asr-0.6b/test-predictions.jsonl
```

Always run the same evaluation on the untouched base model first. Fine-tuning is useful only if it beats the base model on speakers that were not used for training.

## 4. Train TTS with LoRA

Use a separate Python environment for TTS:

```bash
bash training/tts/voxcpm/train_lora.sh \
  training-data/voxcpm \
  runs/voxcpm1.5-lora
```

The script downloads/clones the official VoxCPM code and base model into `.training_deps/` unless paths are provided through environment variables.

Useful overrides:

```bash
LORA_R=64 \
LR=5e-5 \
MAX_STEPS=2000 \
BATCH_SIZE=2 \
GRAD_ACC=8 \
bash training/tts/voxcpm/train_lora.sh \
  training-data/voxcpm \
  runs/voxcpm1.5-lora
```

For dialect adaptation rather than single-speaker cloning, a higher LoRA rank such as 64 is a reasonable starting point. Do not interpret a lower training loss as proof that the model learned the dialect; synthesize a fixed held-out sentence list and evaluate intelligibility with native speakers and an independent ASR model.

## Low-resource experiment order

A practical order is:

1. Freeze the dataset version and speaker-disjoint test set.
2. Measure the untouched base model.
3. Fine-tune Qwen3-ASR-0.6B with conservative SFT.
4. Fine-tune VoxCPM 1.5 with LoRA.
5. Only after that, compare Whisper and CosyVoice/F5-TTS baselines.
6. Report both gains and failures. Small dialect datasets are easy to overfit, especially when the same speakers leak into evaluation.

## Data quality gates

Before training, reject or fix samples with:

- transcript/audio mismatch;
- clipped or heavily distorted speech;
- long trailing silence;
- severe background music/noise;
- duplicate recordings;
- missing training consent;
- the same speaker appearing across train and test.

The model code cannot repair a bad corpus design.