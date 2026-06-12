#!/usr/bin/env bash
# Train the dedicated domino pip-counter, then export to ONNX for the browser.
# Apple Silicon uses the Metal GPU (device=mps); on NVIDIA use device=0.
set -euo pipefail
cd "$(dirname "$0")/.."

DATA=ml/dataset/data.yaml
MODEL=${MODEL:-yolo11n.pt}
EPOCHS=${EPOCHS:-80}
IMGSZ=${IMGSZ:-640}
BATCH=${BATCH:-16}
DEVICE=${DEVICE:-mps}

# exist_ok=True so re-runs reuse ml/runs/domino instead of spawning domino2/, which
# would leave the export step below reading a stale best.pt.
yolo detect train data="$DATA" model="$MODEL" imgsz="$IMGSZ" epochs="$EPOCHS" \
  batch="$BATCH" device="$DEVICE" project=ml/runs name=domino exist_ok=True

# torch's ONNX exporter needs onnxscript + onnxslim (not pulled in by default).
pip install -q onnxscript onnxslim
BEST=ml/runs/domino/weights/best.pt
yolo export model="$BEST" format=onnx imgsz="$IMGSZ" opset=12 simplify=True
echo "ONNX ready next to: $BEST"
echo "Copy it in:  cp ${BEST%.pt}.onnx public/models/domino.onnx"
