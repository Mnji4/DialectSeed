#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${1:-training-data/voxcpm}"
OUTPUT_DIR="${2:-runs/voxcpm1.5-lora}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPS_DIR="${DIALECTSEED_TRAINING_DEPS:-${ROOT_DIR}/.training_deps}"
VOXCPM_REPO="${VOXCPM_REPO:-${DEPS_DIR}/VoxCPM}"
MODEL_ID="${MODEL_ID:-openbmb/VoxCPM1.5}"
MODEL_DIR="${VOXCPM_MODEL_DIR:-${DEPS_DIR}/VoxCPM1.5}"
BATCH_SIZE="${BATCH_SIZE:-2}"
GRAD_ACC="${GRAD_ACC:-8}"
LR="${LR:-5e-5}"
MAX_STEPS="${MAX_STEPS:-2000}"
LORA_R="${LORA_R:-64}"
LORA_ALPHA="${LORA_ALPHA:-128}"
NUM_WORKERS="${NUM_WORKERS:-2}"

mkdir -p "${DEPS_DIR}" "${OUTPUT_DIR}"

if [[ ! -f "${VOXCPM_REPO}/scripts/train_voxcpm_finetune.py" ]]; then
  git clone --depth 1 https://github.com/OpenBMB/VoxCPM.git "${VOXCPM_REPO}"
fi

if [[ ! -f "${MODEL_DIR}/config.json" ]]; then
  python - "${MODEL_ID}" "${MODEL_DIR}" <<'PY'
import sys
from huggingface_hub import snapshot_download
snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2])
PY
fi

TRAIN_FILE="$(cd "${DATA_DIR}" && pwd)/train.jsonl"
VAL_FILE="$(cd "${DATA_DIR}" && pwd)/validation.jsonl"
OUTPUT_ABS="$(mkdir -p "${OUTPUT_DIR}" && cd "${OUTPUT_DIR}" && pwd)"
MODEL_ABS="$(cd "${MODEL_DIR}" && pwd)"
CONFIG_FILE="${OUTPUT_ABS}/dialectseed_voxcpm_lora.yaml"

if [[ ! -s "${TRAIN_FILE}" ]]; then
  echo "Training manifest is empty: ${TRAIN_FILE}" >&2
  exit 1
fi

VAL_YAML="null"
if [[ -s "${VAL_FILE}" ]]; then
  VAL_YAML="${VAL_FILE}"
fi

cat > "${CONFIG_FILE}" <<EOF
pretrained_path: ${MODEL_ABS}
train_manifest: ${TRAIN_FILE}
val_manifest: ${VAL_YAML}
sample_rate: 44100
batch_size: ${BATCH_SIZE}
grad_accum_steps: ${GRAD_ACC}
num_workers: ${NUM_WORKERS}
num_iters: ${MAX_STEPS}
log_interval: 10
valid_interval: 250
save_interval: 250
learning_rate: ${LR}
weight_decay: 0.01
warmup_steps: 100
max_steps: ${MAX_STEPS}
max_batch_tokens: 8192
save_path: ${OUTPUT_ABS}/checkpoints
tensorboard: ${OUTPUT_ABS}/logs
lambdas:
  loss/diff: 1.0
  loss/stop: 1.0
lora:
  enable_lm: true
  enable_dit: true
  enable_proj: false
  r: ${LORA_R}
  alpha: ${LORA_ALPHA}
  dropout: 0.0
hf_model_id: ${MODEL_ID}
distribute: true
EOF

cd "${VOXCPM_REPO}"
python scripts/train_voxcpm_finetune.py --config_path "${CONFIG_FILE}"
