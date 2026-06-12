/*
 * PipTracker backend — runs the pre-trained YOLOv5 domino model client-side via
 * TensorFlow.js. Same detector interface as domino-detector.js so it drops into
 * the live scanner loop:  detect(canvas) -> Promise<{boxes, total, conf}>.
 *
 * Model + weights: "pip-tracker-client" by Ricky Hartmann — MIT License (c) 2023.
 * https://github.com/hartmannr76/pip-tracker-client  (see LICENSE.pip-tracker)
 *
 * The model detects each pip CLUSTER (a domino half) and classifies it pip-1..pip-12;
 * the hand total is simply the sum of every detection's pip value — no pairing needed.
 * I/O (from model.json): input [1,320,320,3] RGB/255 ; output [1,6300,17] =
 *   4 bbox (cx,cy,w,h, normalised 0..1) + 1 objectness + 12 class scores.
 */
(function () {
  "use strict";

  var MODEL_URL = "/models/piptracker/model.json";
  var IN = 320;
  var NMS_MAX = 100, NMS_IOU = 0.5, NMS_SCORE = 0.6;   // mirrors the original app
  var TFJS = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";

  function loadTf() {
    if (window.tf) return Promise.resolve(window.tf);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = TFJS;
      s.onload = function () { resolve(window.tf); };
      s.onerror = function () { reject(new Error("tfjs failed to load")); };
      document.head.appendChild(s);
    });
  }

  function PipTrackerDetector() {
    var tf = null, modelP = null;

    function ensure() {
      if (modelP) return modelP;
      modelP = loadTf().then(function (t) {
        tf = t;
        try { tf.enableProdMode(); } catch (e) {}
        return tf.loadGraphModel(MODEL_URL);
      });
      return modelP;
    }

    var api = {
      backend: "piptracker",
      ready: null,
      detect: function (canvas) {
        if (!canvas) return Promise.resolve({ boxes: [], total: 0, conf: 0 });
        return ensure().then(function (net) {
          var out = tf.tidy(function () {
            var img = tf.image.resizeBilinear(tf.browser.fromPixels(canvas), [IN, IN])
              .div(255.0).expandDims(0);
            var r = net.execute(img).squeeze();                  // [6300,17]
            var p = r.slice([0, 0], [-1, 4]).split(4, -1);       // cx,cy,w,h
            var cx = p[0], cy = p[1], w = p[2], h = p[3];
            var score = r.slice([0, 4], [-1, 1]).squeeze();      // objectness
            var bbox = tf.concat([cx.sub(w.div(2)), cy.sub(h.div(2)),
                                  cx.add(w.div(2)), cy.add(h.div(2))], -1);
            var nms = tf.image.nonMaxSuppressionWithScore(bbox, score, NMS_MAX, NMS_IOU, NMS_SCORE);
            var cls = r.slice([0, 5], [-1, -1]).argMax(-1).gather(nms.selectedIndices);
            return [bbox.gather(nms.selectedIndices), nms.selectedScores, cls];
          });
          return Promise.all([out[0].array(), out[1].data(), out[2].data()]).then(function (a) {
            var boxesArr = a[0], scores = a[1], classes = a[2];
            tf.dispose(out);
            var boxes = [];
            for (var i = 0; i < boxesArr.length; i++) {
              if (scores[i] < NMS_SCORE) continue;
              var b = boxesArr[i];                                // x1,y1,x2,y2 in 0..1
              var x1 = Math.max(0, Math.min(1, b[0])), y1 = Math.max(0, Math.min(1, b[1]));
              var x2 = Math.max(0, Math.min(1, b[2])), y2 = Math.max(0, Math.min(1, b[3]));
              if (x2 - x1 < 0.005 || y2 - y1 < 0.005) continue;
              boxes.push({ cls: classes[i] + 1, x: x1, y: y1, w: x2 - x1, h: y2 - y1, conf: scores[i] });
            }
            var total = boxes.reduce(function (s, b) { return s + b.cls; }, 0);
            var conf = boxes.length ? boxes.reduce(function (s, b) { return s + b.conf; }, 0) / boxes.length : 0;
            return { boxes: boxes, total: total, conf: conf };
          });
        }).catch(function () { return { boxes: [], total: 0, conf: 0 }; });
      }
    };

    // Warm up during load (compiles the WebGL shaders on a blank frame) so the
    // first REAL frame is fast instead of eating the one-time compile cost.
    api.ready = ensure().then(function () {
      var c = document.createElement("canvas");
      c.width = IN; c.height = IN;
      return api.detect(c);
    }).then(function () {});

    return api;
  }

  window.DominoPipTracker = { create: function () { return PipTrackerDetector(); } };
})();
