#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${1:-training-data/qwen3-asr}"
OUTPUT_DIR="${2:-runs/qwen3-asr-0.6b}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPS_DIR="${DIALECTSEED_TRAINING_DEPS:-${ROOT_DIR}/.training_deps}"
QWEN_REPO="${QWEN3_ASR_REPO:-${DEPS_DIR}/Qwen3-ASR}"
MODEL_PATH="${MODEL_PATH:-Qwen/Qwen3-ASR-0.6B}"
BATCH_SIZE="${BATCH_SIZE:-1}"
GRAD_ACC="${GRAD_ACC:-16}"
LR="${LR:-5e-6}"
EPOCHS="${EPOCHS:-2}"
SAVE_STEPS="${SAVE_STEPS:-100}"
SAVE_TOTAL_LIMIT="${SAVE_TOTAL_LIMIT:-3}"
NUM_WORKERS="${NUM_WORKERS:-2}"

mkdir -p "${DEPS_DIR}" "${OUTPUT_DIR}"

if [[ ! -f "${QWEN_REPO}/finetuning/qwen3_asr_sft.py" ]]; then
  git clone --depth 1 https://github.com/QwenLM/Qwen3-ASR.git "${QWEN_REPO}"
fi

TRAIN_FILE="$(cd "${DATA_DIR}" && pwd)/train.jsonl"
VAL_FILE="$(cd "${DATA_DIR}" && pwd)/validation.jsonl"
OUTPUT_ABS="$(mkdir -p "${OUTPUT_DIR}" && cd "${OUTPUT_DIR}" && pwd)"

if [[ ! -s "${TRAIN_FILE}" ]]; then
  echo "Training manifest is empty: ${TRAIN_FILE}" >&2
  exit 1
fi

ARGS=(
  --model_path "${MODEL_PATH}"
  --train_file "${TRAIN_FILE}"
  --output_dir "${OUTPUT_ABS}"
  --batch_size "${BATCH_SIZE}"
  --grad_acc "${GRAD_ACC}"
  --lr "${LR}"
  --epochs "${EPOCHS}"
  --log_steps 10
  --save_strategy steps
  --save_steps "${SAVE_STEPS}"
  --save_total_limit "${SAVE_TOTAL_LIMIT}"
  --num_workers "${NUM_WORKERS}"
  --pin_memory 1
)

if [[ -s "${VAL_FILE}" ]]; then
  ARGS+=(--eval_file "${VAL_FILE}")
fi

cd "${QWEN_REPO}/finetuning"
python qwen3_asr_sft.py "${ARGS[@]}"
