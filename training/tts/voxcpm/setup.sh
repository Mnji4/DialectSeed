#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPS_DIR="${DIALECTSEED_TRAINING_DEPS:-${ROOT_DIR}/.training_deps}"
VOXCPM_REPO="${VOXCPM_REPO:-${DEPS_DIR}/VoxCPM}"

mkdir -p "${DEPS_DIR}"

if [[ ! -f "${VOXCPM_REPO}/pyproject.toml" ]]; then
  git clone --depth 1 https://github.com/OpenBMB/VoxCPM.git "${VOXCPM_REPO}"
fi

python -m pip install -U huggingface_hub
python -m pip install -e "${VOXCPM_REPO}"

python - <<'PY'
import voxcpm
print("VoxCPM training environment is ready.")
PY
