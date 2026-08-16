#!/usr/bin/env bash
set -euo pipefail

python -m pip install -U qwen-asr datasets

if [[ "${INSTALL_FLASH_ATTN:-0}" == "1" ]]; then
  MAX_JOBS="${MAX_JOBS:-4}" python -m pip install -U flash-attn --no-build-isolation
fi

python - <<'PY'
import qwen_asr
import datasets
print("Qwen3-ASR training environment is ready.")
PY
