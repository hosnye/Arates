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
        return Promise.resolve({ boxes: boxes, total: total, conf: conf, tiles: null });
      }
    };
  }

  // ---------- ONNX backend (production) ----------
  // The trained YOLO11n nano model via onnxruntime-web (WebGPU, WASM fallback).
  // Model I/O (verified): input "images" [1,3,640,640] RGB /255; output "output0"
  // [1, 4+numClasses, 8400] — 4 bbox (cx,cy,w,h in 640px) + class scores. numClasses
  // is read from the output shape: 7 (pip halves 0..6) or 8 (halves + whole-tile anchor).
  // Pipeline mirrors the Python validation in ml/ (letterbox → argmax → NMS → map back).
  var ORT_VER = "1.20.1";
  var ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@" + ORT_VER + "/dist/";
  var IN = 640, CONF_T = 0.40, IOU_T = 0.45;
  // Geometry sanity filters — reject detections that can't be a real domino half.
  // A half is roughly square; nothing legitimate is bigger than ~half the frame.
  // These cut most false positives the model hallucinates on busy real backgrounds
  // (patterned cloth, wood grain) that aren't in the synthetic training set.
  var MAX_WH = 0.55;          // drop boxes wider/taller than 55% of the frame
  var MIN_WH = 0.035;         // ...or tinier than a plausible half (edge junk)
  var AR_MIN = 0.35, AR_MAX = 2.8;  // allowed width/height ratio for a half

  // ---------- Independent count verifier ----------
  // The neural net can misread neighbouring counts (3 vs 5) when its box drifts
  // across the divider. Pips are just dark round blobs on a bright tile, so we
  // re-count them with plain pixel analysis on each claimed half and require the
  // two independent counters to AGREE before the app may lock a reading.
  var VS = 56;                                // verifier crop resolution
  var vCanvas = null, vCtx = null;
  function blobCount(src, b) {
    // returns the number of pip-like dark blobs in box b, or -1 if unverifiable
    if (!vCanvas) {
      vCanvas = document.createElement("canvas");
      vCanvas.width = VS; vCanvas.height = VS;
      vCtx = vCanvas.getContext("2d", { willReadFrequently: true });
    }
    // inner 80% of the half — skips the divider bar / tile edge at the borders
    var sx = (b.x + b.w * 0.10) * src.width, sy = (b.y + b.h * 0.10) * src.height;
    var sw = b.w * 0.80 * src.width, sh = b.h * 0.80 * src.height;
    if (sw < 8 || sh < 8) return -1;
    try {
      vCtx.drawImage(src, sx, sy, sw, sh, 0, 0, VS, VS);
      var d = vCtx.getImageData(0, 0, VS, VS).data;
    } catch (e) { return -1; }
    var n = VS * VS, lum = new Float32Array(n), mean = 0;
    for (var i = 0; i < n; i++) {
      var l = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      lum[i] = l; mean += l;
    }
    mean /= n;
    var sd = 0;
    for (i = 0; i < n; i++) { var df = lum[i] - mean; sd += df * df; }
    sd = Math.sqrt(sd / n);
    // dark = clearly below the tile face. On a blank half sd is tiny and the
    // max(20, …) floor means nothing qualifies → returns 0, as it should.
    var thr = mean - Math.max(20, 0.9 * sd);
    var mark = new Uint8Array(n), any = 0;
    for (i = 0; i < n; i++) if (lum[i] < thr) { mark[i] = 1; any++; }
    if (!any) return 0;
    // connected components; keep only round-ish, pip-sized ones
    var label = new Int32Array(n), comps = 0, count = 0, stack = [];
    var minA = n * 0.006, maxA = n * 0.16;
    for (i = 0; i < n; i++) {
      if (!mark[i] || label[i]) continue;
      comps++;
      var area = 0, minx = VS, maxx = 0, miny = VS, maxy = 0;
      stack.length = 0; stack.push(i); label[i] = comps;
      while (stack.length) {
        var p = stack.pop(); area++;
        var px = p % VS, py = (p / VS) | 0;
        if (px < minx) minx = px; if (px > maxx) maxx = px;
        if (py < miny) miny = py; if (py > maxy) maxy = py;
        if (px > 0 && mark[p - 1] && !label[p - 1]) { label[p - 1] = comps; stack.push(p - 1); }
        if (px < VS - 1 && mark[p + 1] && !label[p + 1]) { label[p + 1] = comps; stack.push(p + 1); }
        if (py > 0 && mark[p - VS] && !label[p - VS]) { label[p - VS] = comps; stack.push(p - VS); }
        if (py < VS - 1 && mark[p + VS] && !label[p + VS]) { label[p + VS] = comps; stack.push(p + VS); }
      }
      if (area < minA || area > maxA) continue;
      var bw = maxx - minx + 1, bh = maxy - miny + 1, ar = bw / bh;
      if (ar < 0.45 || ar > 2.2) continue;
      if (area / (bw * bh) < 0.5) continue;       // pips are filled circles
      count++;
    }
    return count > 6 ? -1 : count;                // >6 blobs = garbage crop
  }
  function annotateVerification(src, boxes) {
    for (var i = 0; i < boxes.length; i++) {
      var nb = blobCount(src, boxes[i]);
      boxes[i].blob = nb < 0 ? null : nb;
      boxes[i].verified = nb < 0 ? null : (nb === boxes[i].cls);
    }
  }

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

    function nms(cands) {
      cands.sort(function (a, b) { return b.conf - a.conf; });
      var keep = [];
      for (var a = 0; a < cands.length; a++) {
        if (cands[a].rm) continue;
        keep.push(cands[a]);
        for (var b = a + 1; b < cands.length; b++) {
          if (!cands[b].rm && iou(cands[a], cands[b]) > IOU_T) cands[b].rm = true;
        }
      }
      return keep;
    }
    function toNorm(k, m) {
      return {
        cls: k.cls, conf: k.conf,
        x: ((k.cx - k.w / 2 - m.dw) / m.r) / m.sw,
        y: ((k.cy - k.h / 2 - m.dh) / m.r) / m.sh,
        w: (k.w / m.r) / m.sw,
        h: (k.h / m.r) / m.sh
      };
    }
    function plausibleHalf(b) {
      // geometry sanity: drop oversized/undersized boxes and non-square shapes
      if (b.w > MAX_WH || b.h > MAX_WH) return false;
      if (b.w < MIN_WH || b.h < MIN_WH) return false;
      var ar = b.w / b.h;
      return ar >= AR_MIN && ar <= AR_MAX;
    }

    // Decode [1, 4+numClasses, np] -> source-normalised pip-half boxes.
    // numClasses == 7 → pip halves only (original model).
    // numClasses >= 8 → last class is the whole-tile anchor; we keep only halves
    //   whose centre falls inside a detected tile, so background pip-lookalikes
    //   (carpet/wood/skin) can't score — consistent results across any setup.
    function decode(data, dims, m) {
      var np = dims[2];                       // anchors; value(c,i) = data[c*np + i]
      var numClasses = dims[1] - 4;
      var hasTile = numClasses >= 8;
      var tileCls = numClasses - 1;
      var halfCands = [], tileCands = [];
      for (var i = 0; i < np; i++) {
        var best = 0, bestc = 0;
        for (var c = 0; c < numClasses; c++) {
          var sc = data[(4 + c) * np + i];
          if (sc > best) { best = sc; bestc = c; }
        }
        if (best < CONF_T) continue;
        var cx = data[i], cy = data[np + i], w = data[2 * np + i], h = data[3 * np + i];
        var box = { cx: cx, cy: cy, w: w, h: h, cls: bestc, conf: best,
          x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2, area: w * h };
        if (hasTile && bestc === tileCls) tileCands.push(box);
        else if (bestc <= 6) halfCands.push(box);
      }

      var halves = nms(halfCands);
      var tiles = hasTile ? nms(tileCands) : null;
      if (tiles) {
        halves = halves.filter(function (hb) {
          return tiles.some(function (t) {
            var mx = t.w * 0.12, my = t.h * 0.12;   // tolerance for tight tile boxes
            return hb.cx >= t.x0 - mx && hb.cx <= t.x1 + mx &&
                   hb.cy >= t.y0 - my && hb.cy <= t.y1 + my;
          });
        });
      }
      return {
        boxes: halves.map(function (k) { return toNorm(k, m); }).filter(plausibleHalf),
        tiles: tiles ? tiles.map(function (k) { return toNorm(k, m); }) : null
      };
    }

    return {
      backend: "onnx",
      ready: ready,
      detect: function (src) {
        if (!session || !src) return Promise.resolve({ boxes: [], total: 0, conf: 0, tiles: null });
        var m;
        try { m = preprocess(src); } catch (e) { return Promise.resolve({ boxes: [], total: 0, conf: 0, tiles: null }); }
        var feeds = {}; feeds[inputName] = m.tensor;
        return session.run(feeds).then(function (res) {
          var out = res[outputName] || res[Object.keys(res)[0]];
          var dec = decode(out.data, out.dims, m);
          var boxes = dec.boxes;
          // second opinion: re-count each half's pips with pixel analysis;
          // sets b.blob (count) and b.verified (blob === cls) per box.
          annotateVerification(src, boxes);
          var total = boxes.reduce(function (s, b) { return s + b.cls; }, 0);
          var conf = boxes.length ? boxes.reduce(function (s, b) { return s + b.conf; }, 0) / boxes.length : 0;
          // tiles: null for the legacy 7-class model; [] / boxes for the 8-class one.
          // The app uses it to refuse locking until every tile shows exactly 2 halves.
          return { boxes: boxes, total: total, conf: conf, tiles: dec.tiles };
        }).catch(function (e) {
          console.warn("[DominoDetector] inference error", e);
          return { boxes: [], total: 0, conf: 0, tiles: null };
        });
      }
    };
  }

  window.DominoDetector = {
    // debug/tuning hook for the independent pip counter (used by tests)
    _blobCount: blobCount,
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
