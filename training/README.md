# DialectSeed training

DialectSeed keeps data collection separate from model training. The collection app exports reviewed recordings with explicit model-training consent; this directory turns those exports into reproducible ASR and TTS experiments.

The default recipes stay below one billion parameters. Parameter count alone is not the reason: with a small dialect corpus, pretrained language/dialect coverage, transcript quality, speaker-safe evaluation, and conservative fine-tuning matter more than simply choosing the smallest model.

## Default models

### ASR: Qwen3-ASR-0.6B

Default model: `Qwen/Qwen3-ASR-0.6B`

Why it is the default:

- 0.6B parameters.
- The current upstream release explicitly supports Cantonese plus multiple Chinese dialects and regional accents.
- The official repository includes supervised fine-tuning code using JSONL audio/text pairs.
- Streaming and offline recognition are supported by the same model family.
- Apache-2.0 upstream code and weights.

Upstream: https://github.com/QwenLM/Qwen3-ASR

The official fine-tuner is supervised full-model fine-tuning, not an official LoRA recipe. For small data, start with a low learning rate, a speaker-disjoint validation set, and very few epochs. More epochs are not automatically better.

### TTS: VoxCPM 1.5

Default model: `openbmb/VoxCPM1.5`

Why it is the default:

- It stays below the 1B project target; the current upstream model table lists a 0.6B backbone for VoxCPM1.5.
- Official full fine-tuning and LoRA fine-tuning are both available.
- Upstream explicitly recommends LoRA as the parameter-efficient option.
- The training loader supports optional `ref_audio`, which lets DialectSeed use another clip from the same anonymous speaker as conditioning without crossing dataset splits.
- Apache-2.0 upstream code and weights.

Upstream: https://github.com/OpenBMB/VoxCPM

For a community dialect corpus, the first TTS experiment should be LoRA rather than a full fine-tune. Crowdsourced browser recordings are not automatically studio-quality TTS data: transcript mismatch, clipping, background audio, and long silence can dominate the effect of adding more hours.

## Other models worth benchmarking

- **Whisper small / medium / turbo**: 244M / 769M / roughly 0.8B. They remain useful multilingual ASR baselines with a mature ecosystem. DialectSeed defaults to Qwen3-ASR because its current pretrained coverage explicitly includes Cantonese and a broad set of Chinese dialects.
- **SenseVoiceSmall**: a compact multilingual ASR alternative worth benchmarking when deployment cost is more important than matching the newest ASR stack.
- **CosyVoice 0.5B family**: an important Chinese TTS baseline with strong upstream training infrastructure. It is a good second TTS recipe after the simpler VoxCPM LoRA path is working.
- **F5-TTS (~0.3B)**: simple architecture and official fine-tuning support. The official pretrained weights are CC-BY-NC, so it is not the default for a project that may later need commercial reuse.
- **GPT-SoVITS**: practical for very small speaker-specific datasets and Cantonese use cases, but its usual workflow is closer to voice cloning than the multi-speaker corpus adaptation DialectSeed is targeting.

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

When there are enough speakers, the exporter already assigns speaker-disjoint `train`, `validation`, and `test` splits.

## 2. Prepare model-specific manifests

The preparation script converts browser audio to mono WAV, preserves split boundaries, and writes the format expected by the upstream trainer.

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

For VoxCPM, the converter deterministically gives about 40% of eligible samples a `ref_audio` clip from another recording by the same speaker. Reference clips never cross train/validation/test boundaries. Override this with `--ref-probability` if needed.

## 3. Train ASR

Use a separate Python environment for ASR.

```bash
bash training/asr/qwen3_asr/setup.sh
```

Then train:

```bash
bash training/asr/qwen3_asr/train.sh \
  training-data/qwen3-asr \
  runs/qwen3-asr-0.6b
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

Run the same evaluation on `Qwen/Qwen3-ASR-0.6B` before fine-tuning. A fine-tune is useful only if it improves held-out speakers rather than memorizing training voices.

## 4. Train TTS with LoRA

Use a separate Python environment for TTS:

```bash
bash training/tts/voxcpm/setup.sh
```

Then train:

```bash
bash training/tts/voxcpm/train_lora.sh \
  training-data/voxcpm \
  runs/voxcpm1.5-lora
```

The launcher clones the official VoxCPM repository and downloads the base model into `.training_deps/` unless paths are supplied through environment variables.

Useful overrides:

```bash
LORA_R=64 \
LORA_ALPHA=128 \
LR=5e-5 \
MAX_STEPS=2000 \
BATCH_SIZE=2 \
GRAD_ACC=8 \
bash training/tts/voxcpm/train_lora.sh \
  training-data/voxcpm \
  runs/voxcpm1.5-lora
```

The upstream VoxCPM1.5 LoRA configuration starts from rank 8. DialectSeed exposes rank as an experiment knob rather than claiming that a larger value is universally better.

For evaluation, keep a fixed held-out sentence set and compare both intelligibility and native-speaker judgments. Lower training loss alone does not show that the model learned the dialect.

## Low-resource experiment order

1. Freeze a dataset version and a speaker-disjoint test set.
2. Measure the untouched base models first.
3. Fine-tune Qwen3-ASR-0.6B conservatively.
4. Fine-tune VoxCPM1.5 with LoRA.
5. Compare Whisper and another TTS baseline only after the main pipeline is stable.
6. Report negative results as well as gains. Small speech datasets are unusually easy to overfit through speaker leakage.

## Data quality gates

Before training, reject or fix samples with:

- transcript/audio mismatch;
- clipped or heavily distorted speech;
- long trailing silence;
- severe background music or noise;
- duplicate recordings;
- missing training consent;
- the same speaker appearing across train and test.

The model code cannot repair a badly designed corpus.