#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pip install -r ai_engine/requirements-train.txt
echo "Listo. Coloque imágenes en data/glasses_dataset/with_glasses y without_glasses, luego:"
echo "  python ai_engine/scripts/train_glasses_onnx.py --data_root data/glasses_dataset"
