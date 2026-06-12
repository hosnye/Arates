/*
 * Domino pip detector — pluggable backend for the real-time scanner.
 *
 * Interface:  detector.detect(sourceCanvas) -> Promise<{ boxes, total, conf }>
 *   boxes: [{ cls (0..6), x, y, w, h, conf }]  — x/y/w/h normalised 0..1 to the
 *          source canvas, which is the exact region shown in the viewfinder.
 *   total: sum of every detected half's class (the hand score — no pairing needed).
 *   conf:  mean confidence of the detected halves.
 *
 * Two backends:
 *   - "mock":  fabricates a plausible, mostly-stable hand so the live overlay +
 *              stability-lock UX can be built and felt BEFORE the model exists.
 *   - "onnx":  the trained nano model via onnxruntime-web. Documented stub below;
 *              flip to it once ml/ exports best.onnx -> public/models/domino.onnx.
 */
(function () {
  "use strict";

  // ---------- Mock backend (development) ----------
  function MockDetector() {
    // A fixed "hand": each entry is one domino HALF with its pip count + position
    // (normalised to the viewfinder). Stable enough to lock, with tiny jitter so
    // the smoothing/stability logic is actually exercised.
    var hand = [
      { cls: 5, x: 0.26, y: 0.40, w: 0.14, h: 0.17 },
      { cls: 6, x: 0.26, y: 0.58, w: 0.14, h: 0.17 },
      { cls: 3, x: 0.45, y: 0.38, w: 0.14, h: 0.17 },
      { cls: 2, x: 0.45, y: 0.56, w: 0.14, h: 0.17 },
      { cls: 4, x: 0.64, y: 0.43, w: 0.14, h: 0.17 }
    ];
    var frame = 0;
    return {
      backend: "mock",
      ready: Promise.resolve(),
      detect: function () {
        frame++;
        // First few frames simulate "still searching" — fewer halves visible.
        var visible = frame < 5 ? hand.slice(0, frame) : hand;
        var boxes = visible.map(function (b, i) {
          var jx = Math.sin(frame / 3 + i) * 0.004;   // hair of position jitter
          var jy = Math.cos(frame / 4 + i) * 0.004;
          var conf = 0.84 + Math.sin(frame / 2 + i) * 0.1;
          return {
            cls: b.cls,
            x: b.x + jx, y: b.y + jy, w: b.w, h: b.h,
            conf: Math.max(0.55, Math.min(0.98, conf))
          };
        });
        var total = boxes.reduce(function (s, b) { return s + b.cls; }, 0);
        var conf = boxes.length ? boxes.reduce(function (s, b) { return s + b.conf; }, 0) / boxes.length : 0;
        return Promise.resolve({ boxes: boxes, total: total, conf: conf });
      }
    };
  }

  // ---------- ONNX backend (production) ----------
  // The trained YOLO11n nano model via onnxruntime-web (WebGPU, WASM fallback).
  // Model I/O (verified): input "images" [1,3,640,640] RGB /255; output "output0"
  // [1, 4+7, 8400] — 4 bbox (cx,cy,w,h in 640px) + 7 class scores (pip count 0..6).
  // Pipeline mirrors the Python validation in ml/ (letterbox → argmax → NMS → map back).
  var ORT_VER = "1.20.1";
  var ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/";
  var IN = 640, NC = 7, CONF_T = 0.40, IOU_T = 0.45;
  // Geometry sanity filters — reject detections that can't be a real domino half.
  // A half is roughly square; nothing legitimate is bigger than ~half the frame.
  // These cut most false positives the model hallucinates on busy real backgrounds
  // (patterned cloth, wood grain) that aren't in the synthetic training set.
  var MAX_WH = 0.55;          // drop boxes wider/taller than 55% of the frame
  var AR_MIN = 0.35, AR_MAX = 2.8;  // allowed width/height ratio for a half

  function loadOrt() {
    if (window.ort) return Promise.resolve(window.ort);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = ORT_BASE + "ort.webgpu.min.js";
      s.async = true;
      s.onload = function () { window.ort ? resolve(window.ort) : reject(new Error("ort missing")); };
      s.onerror = function () { reject(new Error("failed to load onnxruntime-web")); };
      document.head.appendChild(s);
    });
  }

  function iou(a, b) {
    var ix0 = Math.max(a.x0, b.x0), iy0 = Math.max(a.y0, b.y0);
    var ix1 = Math.min(a.x1, b.x1), iy1 = Math.min(a.y1, b.y1);
    var iw = Math.max(0, ix1 - ix0), ih = Math.max(0, iy1 - iy0), inter = iw * ih;
    var uni = a.area + b.area - inter;
    return uni <= 0 ? 0 : inter / uni;
  }

  function OnnxDetector(modelUrl) {
    var session = null, ortRef = null, inputName = "images", outputName = "output0";
    var pre = document.createElement("canvas"); pre.width = IN; pre.height = IN;
    var pctx = pre.getContext("2d", { willReadFrequently: true });

    var ready = loadOrt().then(function (ort) {
      ortRef = ort;
      try { ort.env.wasm.wasmPaths = ORT_BASE; } catch (e) {}
      return ort.InferenceSession.create(modelUrl, {
        executionProviders: ["webgpu", "wasm"],
        graphOptimizationLevel: "all"
      });
    }).then(function (s) {
      session = s;
      if (s.inputNames && s.inputNames[0]) inputName = s.inputNames[0];
      if (s.outputNames && s.outputNames[0]) outputName = s.outputNames[0];
    });

    // Letterbox the source canvas into 640x640 (gray pad), return NCHW float32 + transform.
    function preprocess(src) {
      var sw = src.width, sh = src.height;
      var r = Math.min(IN / sw, IN / sh);
      var nw = Math.round(sw * r), nh = Math.round(sh * r);
      var dw = (IN - nw) / 2, dh = (IN - nh) / 2;
      pctx.fillStyle = "#727272"; pctx.fillRect(0, 0, IN, IN);   // 114,114,114 pad
      pctx.drawImage(src, 0, 0, sw, sh, dw, dh, nw, nh);
      var px = pctx.getImageData(0, 0, IN, IN).data;
      var n = IN * IN, f = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        f[i] = px[i * 4] / 255;            // R plane
        f[i + n] = px[i * 4 + 1] / 255;    // G plane
        f[i + 2 * n] = px[i * 4 + 2] / 255; // B plane
      }
      return { tensor: new ortRef.Tensor("float32", f, [1, 3, IN, IN]), r: r, dw: dw, dh: dh, sw: sw, sh: sh };
    }

    // Decode [1, 4+NC, np] -> source-normalised boxes after threshold + NMS.
    function decode(data, dims, m) {
      var np = dims[2];                      // 8400 anchors; value(c,i) = data[c*np + i]
      var cand = [];
      for (var i = 0; i < np; i++) {
        var best = 0, bestc = 0;
        for (var c = 0; c < NC; c++) {
          var sc = data[(4 + c) * np + i];
          if (sc > best) { best = sc; bestc = c; }
        }
        if (best < CONF_T) continue;
        var cx = data[i], cy = data[np + i], w = data[2 * np + i], h = data[3 * np + i];
        cand.push({ cx: cx, cy: cy, w: w, h: h, cls: bestc, conf: best,
          x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, area: w * h });
      }
      cand.sort(function (a, b) { return b.conf - a.conf; });
      var keep = [];
      for (var a = 0; a < cand.length; a++) {
        if (cand[a].rm) continue;
        keep.push(cand[a]);
        for (var b = a + 1; b < cand.length; b++) {
          if (!cand[b].rm && iou(cand[a], cand[b]) > IOU_T) cand[b].rm = true;
        }
      }
      return keep.map(function (k) {
        return {
          cls: k.cls, conf: k.conf,
          x: ((k.cx - k.w / 2 - m.dw) / m.r) / m.sw,
          y: ((k.cy - k.h / 2 - m.dh) / m.r) / m.sh,
          w: (k.w / m.r) / m.sw,
          h: (k.h / m.r) / m.sh
        };
      }).filter(function (b) {
        // geometry sanity: drop oversized boxes and non-square shapes (background junk)
        if (b.w > MAX_WH || b.h > MAX_WH) return false;
        var ar = b.w / b.h;
        return ar >= AR_MIN && ar <= AR_MAX;
      });
    }

    return {
      backend: "onnx",
      ready: ready,
      detect: function (src) {
        if (!session || !src) return Promise.resolve({ boxes: [], total: 0, conf: 0 });
        var m;
        try { m = preprocess(src); } catch (e) { return Promise.resolve({ boxes: [], total: 0, conf: 0 }); }
        var feeds = {}; feeds[inputName] = m.tensor;
        return session.run(feeds).then(function (res) {
          var out = res[outputName] || res[Object.keys(res)[0]];
          var boxes = decode(out.data, out.dims, m);
          var total = boxes.reduce(function (s, b) { return s + b.cls; }, 0);
          var conf = boxes.length ? boxes.reduce(function (s, b) { return s + b.conf; }, 0) / boxes.length : 0;
          return { boxes: boxes, total: total, conf: conf };
        }).catch(function (e) {
          console.warn("[DominoDetector] inference error", e);
          return { boxes: [], total: 0, conf: 0 };
        });
      }
    };
  }

  window.DominoDetector = {
    /**
     * create({ backend }) — "onnx" | "mock" | "auto" (default).
     * "auto" tries ONNX and falls back to mock so the UI always works.
     */
    create: function (opts) {
      opts = opts || {};
      var want = opts.backend || "auto";
      if (want === "onnx" || want === "auto") {
        var onnx = OnnxDetector(opts.modelUrl || "/models/domino.onnx");
        if (onnx) return onnx;
        if (want === "onnx") console.warn("[DominoDetector] ONNX backend unavailable — using mock.");
      }
      return MockDetector();
    }
  };
})();
