# Dedicated on-device domino pip-counter

Goal: replace the Gemini round-trip with a small, purpose-built detector that runs
**in the browser** (every phone — Android + iPhone), offline, in ~tens of ms, and is
*more* accurate at exact pip counting than a general LLM.

## The idea in one line

Detect each domino **half** as an object whose class is its pip count (0–6).
**Hand total = sum of every detected half's class.** No pairing needed to score.

## Pipeline

### 1. Generate the dataset (free, perfectly labelled)

```bash
pip install -r ml/requirements.txt
python ml/generate_dataset.py --num 8000 --out ml/dataset
# sanity-check the boxes first with a tiny labelled preview:
python ml/generate_dataset.py --num 24 --out ml/preview --debug
```

Produces YOLO format: `images/{train,val}`, `labels/{train,val}`, `data.yaml`.
Augmentations baked in: rotation ±45°, brightness/contrast/saturation, blur,
gradient+noise backgrounds, finger occlusion, blank halves, 1–7 tiles per image.

> Tune realism here — this is where accuracy comes from. Add real photos from actual
> play (label them with the same 7 classes) and mix them in for the final few points.

### 2. Train

`yolo11n` (nano) is the right size for the browser.

**Recommended — free Colab T4 GPU (~1–2 h, full accuracy):** open
[`ml/train_colab.ipynb`](train_colab.ipynb). It's **self-contained** — it generates the
dataset in the cloud (nothing to upload), trains the full 80 epochs, and exports the
ONNX. Just upload the notebook to <https://colab.research.google.com> (File → Upload
notebook), set **Runtime → T4 GPU**, and Run all.

**Local (Apple Silicon):** ~18–20 min/epoch on an M1 Pro → ~24 h for 80 epochs (an
overnight job). Use [`train.sh`](train.sh):

```bash
pip install ultralytics onnx onnxruntime onnxscript onnxslim
EPOCHS=80 bash ml/train.sh                 # full run
# quicker first model: EPOCHS=40 IMGSZ=480 bash ml/train.sh   (~7 h)
```

Check `ml/runs/domino/` for mAP, the confusion matrix, and val predictions.

### 3. Export to ONNX (for the browser)

```bash
# torch's ONNX exporter needs onnxscript + onnxslim — install them or export fails
# with "No module named 'onnxscript'".
pip install onnxscript onnxslim
yolo export model=runs/domino/weights/best.pt format=onnx imgsz=640 opset=12 simplify=True
# optional: quantize to shrink + speed up
python -m onnxruntime.quantization.preprocess --input best.onnx --output best-prep.onnx
```

Drop `best.onnx` into `public/models/domino.onnx`.

### 4. Wire into the web app

In `public/index.js`, load `onnxruntime-web` (WebGPU, WASM fallback) and replace the
`fetch("/api/scan-dominoes")` call in `captureAndAnalyze()` with local inference:

```js
// once, lazily:
import * as ort from "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.webgpu.min.js";
const session = await ort.InferenceSession.create("/models/domino.onnx",
  { executionProviders: ["webgpu", "wasm"] });

// per scan: letterbox the canvas to 640x640 -> Float32 NCHW, run, NMS the boxes.
// total = sum of kept boxes' class indices.  tiles[] for display = pair nearest halves.
```

Keep the existing server route as a **low-confidence fallback**: if the on-device
model's mean confidence is below a threshold (or boxes look implausible), fall back to
one Gemini call. Rare → average scan stays fully on-device and instant.

### 5. Close to 100% (UX, in the app)

- Show each tile's confidence; auto-fill high-confidence, highlight low.
- Make the result tiles **tappable to correct** before reporting to the controller.
  One tap fixes the rare miss → applied score is always right.

## Status

- [x] Synthetic dataset generator (`generate_dataset.py`) — validated, boxes align.
- [ ] Generate full dataset + train YOLO11n.
- [ ] Export ONNX, add `public/models/domino.onnx`.
- [ ] Browser inference + NMS in `index.js`; Gemini fallback on low confidence.
- [ ] Tap-to-correct UX on the result card.
