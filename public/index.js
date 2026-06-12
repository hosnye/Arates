(function () {
  "use strict";

  var KEY = "qahwa_score_v4";
  var SEATS = 4;

  var store = {
    load: function () { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    save: function (d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} },
    loadPlayers: function () { try { return JSON.parse(localStorage.getItem(KEY + "_players")); } catch (e) { return null; } },
    savePlayers: function (d) { try { localStorage.setItem(KEY + "_players", JSON.stringify(d)); } catch (e) {} }
  };

  // players = المصدر الوحيد للأسامي (نسخة من جدول players في Supabase)
  // state.seats = اللي على الطاولة (٤)، كل واحد بيشاور على id من players
  var players = [];               // [{id, name, kings, koozes}]
  function freshState() {
    return { target: 300, rounds: 0, over: false, seats: [], controller: "", controllerAt: 0 };
  }

  var state = store.load();
  players = store.loadPlayers() || [];
  if (!state || !state.seats) state = freshState();
  if (typeof state.target !== "number") state.target = 300;
  if (typeof state.rounds !== "number") state.rounds = 0;
  if (typeof state.over !== "boolean") state.over = false;
  if (typeof state.controller !== "string") state.controller = "";
  if (typeof state.controllerAt !== "number") state.controllerAt = 0;
  state.seats.forEach(function (s) { if (!Array.isArray(s.log)) s.log = []; if (typeof s.done !== "boolean") s.done = false; });

  // هوية الجهاز (ثابتة على نفس الموبايل) عشان نعرف مين ماسك التحكم
  var myToken;
  try {
    myToken = localStorage.getItem("qahwa_device");
    if (!myToken) { myToken = "d" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); localStorage.setItem("qahwa_device", myToken); }
  } catch (e) { myToken = "d" + Math.random().toString(36).slice(2, 10); }

  var CODE = "0502";
  var LOCK_STALE_MS = 30000; // لو اللي ماسك التحكم اختفى ٣٠ ثانية، يتفك تلقائي

  function amController() { return !!state.controller && state.controller === myToken; }
  function lockedByOther() {
    return !!state.controller && state.controller !== myToken && (Date.now() - (state.controllerAt || 0) < LOCK_STALE_MS);
  }
  function guardEdit() {
    if (amController()) return true;
    toast("👀 وضع المشاهدة — اللي معاه التحكم بس يقدر يعدّل");
    vibrate(20);
    return false;
  }

  var history = [];
  var grid = document.getElementById("grid");
  // كاش لأغراض الأنميشن (نقارن بيه التغييرات)
  var prevScores = [], prevDone = [], prevKingIdx = -1, prevDangerIdx = -1, animateIn = false;
  function flashClass(el, cls, ms) {
    if (!el || !el.classList) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 450);
  }
  var undoBtn = document.getElementById("undoBtn");

  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function persist() { store.save(state); pushRemote(); }
  function ar(n) { return String(n); }   // أرقام إنجليزي في كل التطبيق
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c];
    });
  }
  function rosterOf(id) { return players.find(function (r) { return r.id === id; }); }
  function nameOf(seat) { var r = rosterOf(seat.id); return r ? r.name : "?"; }
  function seatedIds() { return state.seats.map(function (s) { return s.id; }); }

  function snapshot() {
    history.push(JSON.stringify(state));
    if (history.length > 60) history.shift();
    refreshUndo();
  }

  // زرار التراجع شغّال للمتحكم بس ولمّا يكون فيه خطوة نقدر نرجّعها.
  function refreshUndo() {
    if (!undoBtn) return;
    undoBtn.classList.toggle("disabled", !history.length || !amController());
  }
  function doUndo() {
    if (!amController()) { guardEdit(); return; }
    if (!history.length) return;
    var prev = history.pop();
    try { state = JSON.parse(prev); } catch (e) { return; }
    store.save(state);
    vibrate(15);
    render();          // يعيد الرسم بالحالة القديمة
    pushRemote();      // يزامن الرجوع لباقي الأجهزة
    refreshUndo();
    toast("رجّعت آخر خطوة ↩️");
  }
  if (undoBtn) undoBtn.addEventListener("click", doUndo);

  // الكنج = أقل رقم لو واحد بس
  function kingSeat() {
    var min = Math.min.apply(null, state.seats.map(function (s) { return s.score; }));
    var ks = state.seats.filter(function (s) { return s.score === min; });
    return ks.length === 1 ? state.seats.indexOf(ks[0]) : -1;
  }
  // أعلى رقم لو واحد بس (للتلوين الأحمر بس مش بيخلص الجولة)
  function highSeat() {
    var max = Math.max.apply(null, state.seats.map(function (s) { return s.score; }));
    if (max <= 0) return -1;
    var hi = state.seats.filter(function (s) { return s.score === max; });
    return hi.length === 1 ? state.seats.indexOf(hi[0]) : -1;
  }
  function statusText(i, king, high) {
    var nm = nameOf(state.seats[i]);
    if (i === king) {
      if (nm.indexOf("شريف") >= 0) return "👑 بتيجي مع الهبل دوبل";
      if (nm.indexOf("حسني") >= 0) return "👑 صاحب اللعبة";
      return "👑 الكنج";
    }
    if (i === high && i !== king && state.seats[i].score > 0) {
      if (nm.indexOf("شريف") >= 0) return "😂 الأروانة بتاعتنا";
      if (nm.indexOf("حسني") >= 0) return "😬 سوء توفيق";
      return "🚬 الأعلى دلوقتي";
    }
    return "اضغط تزوّد · دوم مطوّل تصحّح";
  }
  function barColor(score) {
    var pct = (score / state.target) * 100;
    if (score >= state.target || pct > 75) return "var(--red)";
    if (pct > 45) return "var(--amber)";
    return "var(--green)";
  }
  function updateGoal() { document.getElementById("goalNum").textContent = ar(state.target); }

  function render() {
    updateGoal();
    var king = kingSeat(), high = highSeat();
    grid.innerHTML = "";

    state.seats.forEach(function (seat, i) {
      var card = document.createElement("div");
      card.className = "card" + (i === king ? " king" : "") + (i === high && i !== king ? " danger" : "") + (animateIn ? " enter" : "");
      var pct = Math.max(0, Math.min(100, (seat.score / state.target) * 100));

      card.innerHTML =
        '<button class="hist-btn" data-i="' + i + '" title="سجل الحساب">🧾</button>' +
        '<div class="turn-badge ' + (seat.done ? "done" : "pending") + '" title="الدور الحالي">' + (seat.done ? "✓" : "") + '</div>' +
        '<input class="name" value="' + escapeHtml(nameOf(seat)) + '" maxlength="14" spellcheck="false">' +
        '<div class="tap-score" data-i="' + i + '">' +
          '<div class="score">' + ar(seat.score) + '</div>' +
          '<div class="tap-hint">' + statusText(i, king, high) + '</div>' +
        '</div>' +
        '<div class="bar"><i class="' + (seat.score > 0 ? "lit" : "") + '" style="width:' + pct + '%;background:' + barColor(seat.score) + '"></i></div>' +
        '<div class="controls">' +
          '<button class="ctrl minus" data-i="' + i + '" data-act="down">−' + ar(25) + '</button>' +
          '<button class="ctrl add" data-i="' + i + '" data-act="add">+ زود نقط</button>' +
        '</div>';
      grid.appendChild(card);

      // نبض الخطر وقت الرندر (لو اللاعب قريب من الهدف أصلاً)
      var rp = pct;
      if (rp >= 60 && i !== king) {
        var rt = Math.min(1, (rp - 60) / 40);
        card.style.setProperty("--pulse-dur", (1.6 - rt * 1.15).toFixed(2) + "s");
        card.style.setProperty("--pulse-alpha", (0.35 + rt * 0.5).toFixed(2));
        card.style.setProperty("--pulse-spread", Math.round(12 + rt * 22) + "px");
        card.classList.add("pulsing");
      }

      var nameInput = card.querySelector(".name");
      if (!amController()) nameInput.setAttribute("readonly", "readonly");
      var saveName = function () {
        if (!amController()) return;
        var r = rosterOf(seat.id);
        if (!r) return;
        var v = nameInput.value.trim();
        r.name = v || r.name;
        lastLocalEditAt = Date.now();
        store.savePlayers(players);
        dbUpdatePlayer(r);
      };
      // يتحفظ مع كل حرف + عند القفل
      nameInput.addEventListener("input", saveName);
      nameInput.addEventListener("change", function () { saveName(); nameInput.value = rosterOf(seat.id) ? rosterOf(seat.id).name : nameInput.value; });
      nameInput.addEventListener("focus", function () { if (amController()) nameInput.select(); else nameInput.blur(); });

      attachPress(card.querySelector(".tap-score"), i);
      card.querySelector(".hist-btn").addEventListener("click", function (e) { e.stopPropagation(); openHistory(i); });
    });

    grid.querySelectorAll(".ctrl").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!guardEdit()) return;
        var i = parseInt(btn.dataset.i);
        if (btn.dataset.act === "down") applyDelta(i, -25, e);
        else openKeypad(i, "add");
      });
    });
    refreshCloseBtn();
    updateModeBar();
    // صفّر كاش الأنميشن على الوضع الحالي عشان أول updateView مايعملش وميض غلط
    animateIn = false;
    prevScores = state.seats.map(function (s) { return s.score; });
    prevDone = state.seats.map(function (s) { return s.done; });
    prevKingIdx = king; prevDangerIdx = (high !== king ? high : -1);
  }

  function attachPress(el, i) {
    var timer = null, fired = false, sx = 0, sy = 0, moved = false;
    var card = el.parentElement;
    function tiltReset() { card.style.transition = ""; card.style.transform = ""; }
    el.addEventListener("pointerdown", function (e) {
      fired = false; moved = false; sx = e.clientX; sy = e.clientY;
      timer = setTimeout(function () { fired = true; if (guardEdit()) { vibrate(28); openKeypad(i, "set"); } }, 480);

      // موجة ضوء من نقطة اللمس بالظبط
      var rect = el.getBoundingClientRect();
      var rip = document.createElement("span");
      rip.className = "ripple";
      rip.style.left = (e.clientX - rect.left) + "px";
      rip.style.top = (e.clientY - rect.top) + "px";
      el.appendChild(rip);
      setTimeout(function () { rip.remove(); }, 650);

      // ميلان ثلاثي الأبعاد ناحية الصباع
      var cr = card.getBoundingClientRect();
      var rx = -((e.clientY - cr.top) / cr.height - 0.5) * 7;
      var ry = ((e.clientX - cr.left) / cr.width - 0.5) * 7;
      card.style.transition = "transform .09s ease-out";
      card.style.transform = "perspective(700px) rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg) scale(.985)";
    });
    el.addEventListener("pointermove", function (e) {
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { moved = true; clearTimeout(timer); tiltReset(); }
    });
    el.addEventListener("pointerup", function () {
      clearTimeout(timer); tiltReset();
      if (fired) { fired = false; return; }
      if (moved) return;
      if (!guardEdit()) return;
      openKeypad(i, "add");
    });
    el.addEventListener("pointercancel", function () { clearTimeout(timer); tiltReset(); });
    el.addEventListener("pointerleave", function () { clearTimeout(timer); tiltReset(); });
  }

  // عدّاد متدحرج: الرقم بيعدّ لحد القيمة الجديدة بدل ما ينط
  var scoreTweens = {};
  function tweenScore(el, from, to, i) {
    if (from === undefined || from === to) { el.textContent = ar(to); return; }
    cancelAnimationFrame(scoreTweens[i]);
    var start = performance.now();
    var dur = Math.min(700, 240 + Math.abs(to - from) * 12);
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      el.textContent = ar(Math.round(from + (to - from) * e));
      if (t < 1) scoreTweens[i] = requestAnimationFrame(frame);
    }
    scoreTweens[i] = requestAnimationFrame(frame);
  }

  // شرر ذهبي بينفجر لما اللاعب يبقى كنج
  function sparkle(card) {
    for (var k = 0; k < 12; k++) {
      var s = document.createElement("i");
      s.className = "spark";
      s.style.left = (25 + Math.random() * 50) + "%";
      s.style.top = (28 + Math.random() * 36) + "%";
      s.style.setProperty("--dx", (Math.random() * 140 - 70).toFixed(0) + "px");
      s.style.setProperty("--dy", (-40 - Math.random() * 80).toFixed(0) + "px");
      s.style.animationDelay = (Math.random() * 0.14).toFixed(2) + "s";
      card.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 1000); })(s);
    }
  }

  function updateView() {
    var king = kingSeat(), high = highSeat();
    var dangerIdx = (high !== king ? high : -1);
    grid.querySelectorAll(".card").forEach(function (card, i) {
      var sc = state.seats[i].score;
      var scoreEl = card.querySelector(".score");
      var changed = prevScores[i] !== undefined && prevScores[i] !== sc;
      tweenScore(scoreEl, prevScores[i], sc, i);

      // نبضة الرقم + لكمة خفيفة للكارت كله
      if (changed) { flashClass(scoreEl, "pop", 430); flashClass(card, "punch", 340); }

      var wasKing = card.classList.contains("king");
      card.classList.toggle("king", i === king);
      card.classList.toggle("danger", i === high && i !== king);
      card.querySelector(".tap-hint").textContent = statusText(i, king, high);

      // توهّج ذهبي + انفجار شرر لما يبقى كنج، اهتزازة لما يقرّب من الكوز (بس عند التغيّر)
      if (i === king && prevKingIdx !== king) { flashClass(card, "king-flash", 820); sparkle(card); }
      if (i === dangerIdx && prevDangerIdx !== dangerIdx) flashClass(card, "danger-shake", 470);

      var pct = Math.max(0, Math.min(100, (sc / state.target) * 100));
      var bar = card.querySelector(".bar > i");
      if (bar) {
        bar.style.width = pct + "%";
        bar.style.background = barColor(sc);
        bar.classList.toggle("hot", pct > 80);
        bar.classList.toggle("lit", sc > 0);
      }

      // نبض الخطر: يبدأ من ٦٠٪ ويسرّع ويحمرّ كل ما يقرب من الهدف
      if (pct >= 60 && i !== king) {
        var t = Math.min(1, (pct - 60) / 40);            // 0 عند ٦٠٪ → 1 عند الهدف
        var dur = (1.6 - t * 1.15).toFixed(2);            // من ١.٦ث لحد ٠.٤٥ث
        var alpha = (0.35 + t * 0.5).toFixed(2);          // من خفيف لحد قوي
        var spread = Math.round(12 + t * 22);             // توهّج أوسع
        card.style.setProperty("--pulse-dur", dur + "s");
        card.style.setProperty("--pulse-alpha", alpha);
        card.style.setProperty("--pulse-spread", spread + "px");
        card.classList.add("pulsing");
      } else {
        card.classList.remove("pulsing");
      }

      var tb = card.querySelector(".turn-badge");
      if (tb) {
        var wasDone = prevDone[i];
        tb.className = "turn-badge " + (state.seats[i].done ? "done" : "pending");
        tb.textContent = state.seats[i].done ? "✓" : "";
        if (state.seats[i].done && !wasDone) flashClass(tb, "pop", 420);
      }
    });
    // حدّث الكاش
    prevScores = state.seats.map(function (s) { return s.score; });
    prevDone = state.seats.map(function (s) { return s.done; });
    prevKingIdx = king; prevDangerIdx = dangerIdx;
    refreshCloseBtn();
  }

  // علّم اللاعب إنه اتحسب في الدور الحالي. لو الأربعة خلصوا، يبدأ دور جديد
  function markDone(i) {
    if (state.seats.every(function (s) { return s.done; })) {
      state.seats.forEach(function (s) { s.done = false; });
    }
    state.seats[i].done = true;
  }

  function applyDelta(i, delta, evt) {
    if (!amController()) return;
    snapshot();
    state.seats[i].score += delta;
    if (!state.seats[i].log) state.seats[i].log = [];
    state.seats[i].log.push({ op: "add", d: delta, t: Date.now(), total: state.seats[i].score });
    markDone(i);
    vibrate(delta > 0 ? 14 : 12);
    playTick(delta < 0 ? "minus" : "add");
    persist();
    showFloat(evt, delta, i);
    updateView();
  }
  function setScore(i, val) {
    if (!amController()) return;
    snapshot();
    state.seats[i].score = val;
    if (!state.seats[i].log) state.seats[i].log = [];
    state.seats[i].log.push({ op: "set", v: val, t: Date.now(), total: val });
    markDone(i);
    vibrate(14); playTick("add"); persist(); updateView();
  }

  function showFloat(evt, delta, i) {
    var card;
    if (evt && evt.currentTarget && evt.currentTarget.closest) card = evt.currentTarget.closest(".card");
    if (!card) card = grid.querySelectorAll(".card")[i];
    if (!card) return;
    var f = document.createElement("div");
    f.className = "float " + (delta > 0 ? "plus" : "minus");
    f.textContent = (delta > 0 ? "+" : "−") + ar(Math.abs(delta));
    var rect = card.getBoundingClientRect();
    if (evt && evt.clientX) {
      f.style.left = (evt.clientX - rect.left - 12) + "px";
      f.style.top = (evt.clientY - rect.top - 24) + "px";
    } else { f.style.left = "50%"; f.style.top = "38%"; f.style.transform = "translateX(-50%)"; }
    f.style.position = "absolute";
    card.appendChild(f);
    setTimeout(function () { f.remove(); }, 650);
  }

  /* ===== الكيباد ===== */
  var kpBg = document.getElementById("kpBg");
  var kpDisp = document.getElementById("kpDisp");
  var kpPrev = document.getElementById("kpPreview");
  var kpTitle = document.getElementById("kpTitle");
  var kpOk = document.getElementById("kpOk");
  var kpSwitch = document.getElementById("kpSwitch");
  var kpVal = "", kpTarget = -1, kpMode = "add";

  // يبيّن زرار التبديل «زيادة ⇄ تصحيح» حسب الوضع الحالي (مخفي في كود التحكم/الهدف).
  function syncKpSwitch() {
    if (!kpSwitch) return;
    if (kpMode === "add") { kpSwitch.style.display = "block"; kpSwitch.textContent = "✏️ صحّح السكور بدل ما تزوّد"; }
    else if (kpMode === "set") { kpSwitch.style.display = "block"; kpSwitch.textContent = "➕ زوّد نقط بدل ما تصحّح"; }
    else { kpSwitch.style.display = "none"; }
  }
  if (kpSwitch) kpSwitch.addEventListener("click", function () {
    if (kpMode === "add") kpMode = "set";
    else if (kpMode === "set") kpMode = "add";
    else return;
    kpVal = "";
    var nm = escapeHtml(nameOf(state.seats[kpTarget]));
    kpTitle.innerHTML = (kpMode === "add" ? "زود نقط لـ <b>" : "صحّح سكور <b>") + nm + "</b>";
    syncKpSwitch();
    refreshKp();
    vibrate(6);
  });

  function openKeypad(i, mode) {
    if (mode !== "code" && state.over) return;
    kpMode = mode; kpTarget = i; kpVal = "";
    if (mode === "add") kpTitle.innerHTML = 'زود نقط لـ <b>' + escapeHtml(nameOf(state.seats[i])) + '</b>';
    else if (mode === "set") kpTitle.innerHTML = 'صحّح سكور <b>' + escapeHtml(nameOf(state.seats[i])) + '</b>';
    else if (mode === "code") kpTitle.innerHTML = 'اكتب <b>كود التحكم</b>';
    else kpTitle.innerHTML = 'غيّر الهدف';
    syncKpSwitch();
    refreshKp();
    kpBg.classList.add("show");
  }
  function refreshKp() {
    if (kpVal === "") {
      kpDisp.textContent = "0"; kpDisp.classList.add("empty");
      kpOk.classList.add("disabled"); kpPrev.textContent = "";
      return;
    }
    kpDisp.classList.remove("empty");
    var v = parseInt(kpVal, 10);
    if (kpMode === "code") {
      kpDisp.textContent = ar(kpVal);
      kpPrev.textContent = kpVal.length === 4 ? "" : "4 أرقام";
      kpOk.classList.toggle("disabled", kpVal.length !== 4);
    } else if (kpMode === "add") {
      kpOk.classList.remove("disabled");
      kpDisp.textContent = "+" + ar(kpVal); kpPrev.textContent = "هيبقى " + ar(state.seats[kpTarget].score + v);
    } else if (kpMode === "set") {
      kpOk.classList.remove("disabled");
      kpDisp.textContent = ar(kpVal); kpPrev.textContent = "السكور هيبقى " + ar(v);
    } else {
      kpOk.classList.remove("disabled");
      kpDisp.textContent = ar(kpVal); kpPrev.textContent = "الهدف هيبقى " + ar(v);
    }
  }
  document.querySelectorAll("#kpBg .kp-key").forEach(function (k) {
    k.addEventListener("click", function () {
      var key = k.dataset.k;
      if (key === "ok") {
        if (kpVal === "") return;
        var mode = kpMode, i = kpTarget;
        if (mode === "code") {
          if (kpVal.length !== 4) return;
          var entered = kpVal; kpBg.classList.remove("show"); tryTakeControl(entered); return;
        }
        var v = parseInt(kpVal, 10);
        kpBg.classList.remove("show");
        if (mode === "add") applyDelta(i, v, null);
        else if (mode === "set") setScore(i, v);
        else setTarget(v);
        return;
      }
      if (key === "back") kpVal = kpVal.slice(0, -1);
      else if (kpVal.length < 4) kpVal += key;
      vibrate(6); refreshKp();
    });
  });
  document.getElementById("kpCancel").addEventListener("click", function () { kpBg.classList.remove("show"); });
  kpBg.addEventListener("click", function (e) { if (e.target === kpBg) kpBg.classList.remove("show"); });

  function setTarget(v) {
    if (!amController()) return;
    if (v < 1) return;
    snapshot(); state.target = v; vibrate(15); persist(); render(); toast("الهدف بقى " + ar(v));
  }
  document.getElementById("goalLine").addEventListener("click", function () { if (guardEdit()) openKeypad(-1, "target"); });


  /* ===== نافذة التأكيد ===== */
  var sheetBg = document.getElementById("sheetBg");
  var confirmAction = null;
  function openSheet(title, text, action) {
    document.getElementById("sheetTitle").textContent = title;
    document.getElementById("sheetText").textContent = text;
    confirmAction = action; sheetBg.classList.add("show");
  }
  function closeSheet() { sheetBg.classList.remove("show"); confirmAction = null; }
  document.getElementById("sheetCancel").addEventListener("click", closeSheet);
  sheetBg.addEventListener("click", function (e) { if (e.target === sheetBg) closeSheet(); });
  document.getElementById("sheetConfirm").addEventListener("click", function () { if (confirmAction) confirmAction(); closeSheet(); });

  document.getElementById("resetAll").addEventListener("click", function () {
    if (!guardEdit()) return;
    openSheet("جلسة جديدة؟", "هيصفّر النقط ويبدأ جولة جديدة بنفس اللاعبين. الإحصائيات التراكمية (كنج/كوز) هتفضل زي ما هي.", function () {
      state.seats.forEach(function (s) { s.score = 0; s.log = []; s.done = false; });
      state.rounds = 0; state.over = false;
      state.controller = myToken; state.controllerAt = Date.now();
      history = []; undoBtn.classList.add("disabled");
      document.getElementById("resultBg").classList.remove("show");
      document.getElementById("pickBg").classList.remove("show");
      animateIn = true; vibrate(25); persist(); render();
      toast("جلسة جديدة 🔄");
    });
  });

  /* ===== قفل الجولة (ممكن يطلع لحد ٣) ===== */
  var pickBg = document.getElementById("pickBg");
  var countBg = document.getElementById("countBg");
  var closeBtn = document.getElementById("closeRound");

  closeBtn.addEventListener("click", function () {
    if (!guardEdit()) return;
    var max = Math.max.apply(null, state.seats.map(function (s) { return s.score; }));
    if (max < state.target) {
      var need = state.target - max;
      toast("لسه محدش وصل " + ar(state.target) + " · فاضل " + ar(need));
      vibrate(20);
      return;
    }
    openCountPicker();
  });

  // ١) اختار كام واحد هيطلع
  function openCountPicker() {
    var maxOut = Math.min(3, state.seats.length - 1);
    var btns = document.getElementById("countBtns");
    btns.innerHTML = "";
    for (var n = 1; n <= maxOut; n++) {
      (function (k) {
        var b = document.createElement("button");
        b.className = "btn-cancel";
        b.style.fontSize = "20px"; b.style.fontWeight = "900";
        b.textContent = k;
        b.addEventListener("click", function () { countBg.classList.remove("show"); chooseCount(k); });
        btns.appendChild(b);
      })(n);
    }
    // خيار: محدش يطلع (مفيش حد قاعد بره)
    var none = document.createElement("button");
    none.className = "btn-cancel";
    none.style.fontWeight = "800";
    none.textContent = "محدش";
    none.addEventListener("click", function () { countBg.classList.remove("show"); chooseNoLeave(); });
    btns.appendChild(none);
    countBg.classList.add("show");
  }
  document.getElementById("countCancel").addEventListener("click", function () { countBg.classList.remove("show"); });
  countBg.addEventListener("click", function (e) { if (e.target === countBg) countBg.classList.remove("show"); });

  // ٢) حدد أعلى N سكور (مع فك التعادل لو لزم)
  function chooseCount(n) {
    var order = state.seats.map(function (s, i) { return i; }).sort(function (a, b) { return state.seats[b].score - state.seats[a].score; });
    var boundary = state.seats[order[n - 1]].score;
    var auto = [], tied = [];
    state.seats.forEach(function (s, i) {
      if (s.score > boundary) auto.push(i);
      else if (s.score === boundary) tied.push(i);
    });
    var remaining = n - auto.length;
    if (tied.length === remaining) confirmKoozes(auto.concat(tied), false);
    else openTiePicker(auto, tied, remaining, false);
  }

  // محدش يطلع: نسجّل أعلى رقم كوز للجلسة بس، والكل يكمّل جولة جديدة
  function chooseNoLeave() {
    var max = Math.max.apply(null, state.seats.map(function (s) { return s.score; }));
    var top = [];
    state.seats.forEach(function (s, i) { if (s.score === max) top.push(i); });
    if (top.length === 1) confirmKoozes(top, true);
    else openTiePicker([], top, 1, true);
  }

  // ٢-ب) اختيار اللي يطلعوا (أو الكوز للتسجيل لو محدش هيطلع)
  var pickSel = [], pickAuto = [], pickNeed = 0, pickNoLeave = false;
  function openTiePicker(auto, tied, remaining, noLeave) {
    pickAuto = auto; pickNeed = remaining; pickSel = []; pickNoLeave = !!noLeave;
    document.getElementById("pickSub").textContent = noLeave
      ? "تعادل في الأعلى — اختار مين يتسجّل كوز للجلسة"
      : "فيه تعادل في السكور — اختار " + remaining + " اللي هيطلعوا";
    var row = document.getElementById("pickRow");
    row.innerHTML = "";
    tied.forEach(function (i) {
      var b = document.createElement("button");
      b.className = "pick-btn"; b.dataset.i = i;
      b.innerHTML = '<span>' + escapeHtml(nameOf(state.seats[i])) + '</span><span class="s">' + ar(state.seats[i].score) + '</span>';
      b.addEventListener("click", function () {
        var pos = pickSel.indexOf(i);
        if (pos >= 0) { pickSel.splice(pos, 1); b.classList.remove("sel"); }
        else { if (pickSel.length >= pickNeed) return; pickSel.push(i); b.classList.add("sel"); }
        refreshPickConfirm();
      });
      row.appendChild(b);
    });
    refreshPickConfirm();
    pickBg.classList.add("show");
  }
  function refreshPickConfirm() {
    var ok = pickSel.length === pickNeed;
    var btn = document.getElementById("pickConfirm");
    btn.style.opacity = ok ? "1" : ".4";
    btn.style.pointerEvents = ok ? "auto" : "none";
  }
  document.getElementById("pickConfirm").addEventListener("click", function () {
    if (pickSel.length !== pickNeed) return;
    pickBg.classList.remove("show");
    confirmKoozes(pickAuto.concat(pickSel), pickNoLeave);
  });

  // ٣) تأكيد
  function confirmKoozes(indices, noLeave) {
    var names = indices.map(function (i) { return nameOf(state.seats[i]); }).join(" و ");
    if (noLeave) {
      openSheet("محدش هيطلع", names + " يتسجّل كوز للجلسة، ومحدش يطلع · جولة جديدة بنفس اللاعبين — تمام؟", function () { finishRound(indices, true); });
    } else {
      openSheet(indices.length > 1 ? "هيطلعوا" : "هيطلع", names + " — تمام؟", function () { finishRound(indices, false); });
    }
  }

  // الزرار يبقى باهت لحد ما حد يوصل الهدف، وقتها يولّع ذهبي
  function refreshCloseBtn() {
    var max = Math.max.apply(null, state.seats.map(function (s) { return s.score; }));
    var ready = max >= state.target;
    closeBtn.classList.toggle("dim", !ready);
    closeBtn.textContent = ready ? "🏁 اقفل الجولة" : "🏁 اقفل الجولة (لسه)";
  }

  var lastResult = null;

  function finishRound(koozIdxs, noLeave) {
    if (!amController()) return;
    snapshot();
    var min = Math.min.apply(null, state.seats.map(function (s) { return s.score; }));
    var max = Math.max.apply(null, state.seats.map(function (s) { return s.score; }));
    var kingSeats = [];
    state.seats.forEach(function (s, i) { if (s.score === min) kingSeats.push(i); });

    // الكوز في نتايج الجلسة = صاحب أعلى رقم بس (لو تعادل في الأعلى الكل ياخد كوز)،
    // مش كل اللي طالعين. اللي بيطلعوا الزيادة بيطلعوا من غير ما يتحسبوا أكواز.
    var koozTally = [];
    state.seats.forEach(function (s, i) { if (s.score === max) koozTally.push(i); });

    kingSeats.forEach(function (i) { var r = rosterOf(state.seats[i].id); if (r) { r.kings += 1; dbUpdatePlayer(r); } });
    koozTally.forEach(function (i) { var r = rosterOf(state.seats[i].id); if (r) { r.koozes += 1; dbUpdatePlayer(r); } });
    store.savePlayers(players);
    state.rounds += 1;

    // سجّل الأحداث في تاريخ النتايج (لكل كنج وكل كوز) مع مين كان على الطاولة
    var tableIds = seatedIds();
    kingSeats.forEach(function (i) { dbLogResult(state.seats[i].id, "king", state.seats[i].score, tableIds); });
    koozTally.forEach(function (i) { dbLogResult(state.seats[i].id, "kooz", state.seats[i].score, tableIds); });

    var snap = state.seats.map(function (s, i) {
      return { name: nameOf(s), score: s.score, idx: i, isKooz: koozTally.indexOf(i) >= 0, isOut: koozIdxs.indexOf(i) >= 0, isKing: kingSeats.indexOf(i) >= 0 };
    }).sort(function (a, b) { return a.score - b.score; });
    lastResult = {
      koozIdxs: koozIdxs.slice(),
      koozNames: koozTally.map(function (i) { return nameOf(state.seats[i]); }),
      outNames: koozIdxs.map(function (i) { return nameOf(state.seats[i]); }),
      snap: snap, kingTie: kingSeats.length > 1, noLeave: !(!noLeave)
    };

    state.over = true;
    persist();
    showResult();
  }

  var resultBg = document.getElementById("resultBg");
  function showResult() {
    var r = lastResult;
    if (r.noLeave) {
      document.getElementById("resKoozName").textContent = "🚬 " + r.koozNames.join(" و ") + " الكوز";
      document.getElementById("resSub").textContent = "محدش طلع — اتسجّل للجلسة وهتبدأ جولة جديدة بنفس اللاعبين.";
      document.getElementById("resNext").textContent = "🔄 جولة جديدة";
    } else {
      var koozTxt = "🚬 " + r.koozNames.join(" و ") + (r.koozNames.length > 1 ? " الكوز" : " الكوز");
      document.getElementById("resKoozName").textContent = koozTxt;
      var extraOut = r.outNames.filter(function (n) { return r.koozNames.indexOf(n) < 0; });
      var subTxt = r.koozIdxs.length > 1 ? ("هيطلع: " + r.outNames.join(" و ")) : "هيطلع ويدخل غيره";
      if (r.kingTie) subTxt += " · تعادل في الأقل، الكل كنج 👑";
      document.getElementById("resSub").textContent = subTxt;
      document.getElementById("resNext").textContent = r.koozIdxs.length > 1 ? "🔄 يطلعوا وجولة جديدة" : "🔄 يطلع وجولة جديدة";
    }

    var list = document.getElementById("resList");
    list.innerHTML = "";
    r.snap.forEach(function (p, rank) {
      var row = document.createElement("div");
      row.className = "res-row" + (p.isKing ? " king-row" : "") + (p.isKooz ? " kooz-row" : "");
      var medal = p.isKooz ? "🚬" : (p.isKing ? "👑" : (p.isOut ? "🚪" : ar(rank + 1)));
      var suffix = (p.isOut && !p.isKooz) ? ' <span style="color:var(--muted);font-size:12px">(طالع)</span>' : "";
      row.innerHTML =
        '<div class="res-rank">' + medal + '</div>' +
        '<div class="res-name">' + escapeHtml(p.name) + suffix + '</div>' +
        '<div class="res-score">' + ar(p.score) + '</div>';
      row.style.animationDelay = (rank * 0.07) + "s";
      list.appendChild(row);
    });
    setTimeout(function () { resultBg.classList.add("show"); confetti(resultBg); playFanfare(); }, 320);
    vibrate([40, 60, 40, 60, 80]);
  }

  // نغمة قصيرة بالكود (من غير ملف صوت) — بتشتغل لو الموبايل مش على Silent
  var audioCtx = null;
  function ensureAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }
  // الآيفون بيقفل الصوت لحد أول لمسة — نفكّه من أول تفاعل
  document.addEventListener("pointerdown", ensureAudio);

  // أصوات لمسية خفيفة: نقرة ناعمة للزيادة، نبرة واطية للخصم
  function playTick(kind) {
    try {
      ensureAudio();
      if (!audioCtx) return;
      var t = audioCtx.currentTime;
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine";
      var f = kind === "minus" ? 150 : 540 + Math.random() * 50;
      o.frequency.setValueAtTime(f, t);
      if (kind !== "minus") o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === "minus" ? 0.11 : 0.06, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "minus" ? 0.2 : 0.11));
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + 0.22);
    } catch (e) {}
  }

  function playFanfare() {
    try {
      ensureAudio();
      if (!audioCtx) return;
      var now = audioCtx.currentTime;
      function tone(freq, start, dur, peak, type) {
        var t = now + start;
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = type || "square";
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(t); osc.stop(t + dur + 0.02);
      }
      tone(392.00, 0.00, 0.14, 0.22, "square");
      tone(523.25, 0.16, 0.55, 0.20, "square");
      tone(659.25, 0.16, 0.55, 0.16, "square");
      tone(783.99, 0.16, 0.55, 0.14, "triangle");
    } catch (e) {}
  }

  function confetti(container) {
    var colors = ["#f5c451", "#e8954f", "#7fae6b", "#d9694e", "#f0a868"];
    for (var n = 0; n < 44; n++) {
      var c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[n % colors.length];
      c.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";
      c.style.animationDelay = (Math.random() * 0.4) + "s";
      c.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
      container.appendChild(c);
      (function (el) { setTimeout(function () { el.remove(); }, 3400); })(c);
    }
  }

  // الكوز يطلع → اختار من القايمة أو اسم جديد → جولة جديدة بصفر للكل
  var newPlayerBg = document.getElementById("newPlayerBg");
  var newPlayerInput = document.getElementById("newPlayerName");
  var namePicks = document.getElementById("namePicks");
  var newNameRow = document.getElementById("newNameRow");
  var koozQueue = [], swapNames = {};

  document.getElementById("resNext").addEventListener("click", function () {
    if (!amController()) return;
    resultBg.classList.remove("show");
    if (lastResult.noLeave) {
      state.seats.forEach(function (s) { s.score = 0; s.log = []; s.done = false; });
      state.over = false;
      history = []; undoBtn.classList.add("disabled");
      animateIn = true; vibrate(20); persist(); render();
      toast("جولة جديدة 🔄");
      return;
    }
    koozQueue = lastResult.koozIdxs.slice();
    swapNames = {};
    processNextSwap();
  });

  function normName(s) { return String(s).trim().replace(/\s+/g, " "); }

  function takenIds() { return Object.keys(swapNames).map(function (k) { return swapNames[k].id; }).filter(Boolean); }
  function takenNames() { return Object.keys(swapNames).map(function (k) { return swapNames[k].name; }).filter(Boolean).map(normName); }

  function processNextSwap() {
    if (!koozQueue.length) { applyAllSwaps(); return; }
    pickMode = "round"; pickSeatIdx = -1;
    var idx = koozQueue[0];
    var done = lastResult.koozIdxs.length - koozQueue.length + 1;
    var total = lastResult.koozIdxs.length;
    var counter = total > 1 ? " (" + done + "/" + total + ")" : "";
    document.getElementById("newPlayerSub").textContent = nameOf(state.seats[idx]) + " طلع. مين داخل مكانه" + counter + "؟";

    var tIds = takenIds(), tNames = takenNames(), seated = seatedIds();
    var candidates = players.filter(function (r) {
      return seated.indexOf(r.id) < 0 && tIds.indexOf(r.id) < 0 && tNames.indexOf(normName(r.name)) < 0;
    });
    namePicks.innerHTML = "";
    if (!candidates.length) {
      namePicks.innerHTML = '<div class="name-list-empty">مفيش لاعبين تانيين في البنك — اكتب اسم جديد 👇</div>';
    } else {
      candidates.forEach(function (r) {
        var b = document.createElement("button");
        b.className = "name-pick";
        b.innerHTML = '<span>' + escapeHtml(r.name) + '</span><span class="tally">كنج ' + ar(r.kings) + ' · كوز ' + ar(r.koozes) + '</span>';
        b.addEventListener("click", function () { chosen({ id: r.id }); });
        namePicks.appendChild(b);
      });
    }
    newNameRow.style.display = "none";
    newPlayerInput.value = "";
    newPlayerBg.classList.add("show");
  }

  function commitSwap(payload) {
    if (!koozQueue.length) return;
    swapNames[koozQueue[0]] = payload;
    koozQueue.shift();
    newPlayerBg.classList.remove("show");
    if (koozQueue.length) setTimeout(processNextSwap, 150);
    else applyAllSwaps();
  }

  var pickMode = "round", pickSeatIdx = -1;
  function chosen(payload) {
    if (pickMode === "single") { applySeatChange(pickSeatIdx, payload); return; }
    commitSwap(payload);
  }

  function doSwapNew() {
    if (!amController()) return;
    var nm = normName(newPlayerInput.value);
    if (!nm) { newPlayerInput.focus(); return; }
    chosen({ name: nm });
  }

  function openSeatChange(idx) {
    if (!amController()) { toast("لازم تكون المتحكم"); return; }
    pickMode = "single"; pickSeatIdx = idx;
    document.getElementById("newPlayerSub").textContent = "مين يقعد مكان " + nameOf(state.seats[idx]) + "؟";
    var seated = seatedIds();
    var candidates = players.filter(function (r) { return seated.indexOf(r.id) < 0; });
    namePicks.innerHTML = "";
    if (!candidates.length) {
      namePicks.innerHTML = '<div class="name-list-empty">مفيش لاعبين تانيين في البنك — اكتب اسم جديد 👇</div>';
    } else {
      candidates.forEach(function (r) {
        var b = document.createElement("button");
        b.className = "name-pick";
        b.innerHTML = '<span>' + escapeHtml(r.name) + '</span><span class="tally">كنج ' + ar(r.kings) + ' · كوز ' + ar(r.koozes) + '</span>';
        b.addEventListener("click", function () { chosen({ id: r.id }); });
        namePicks.appendChild(b);
      });
    }
    newNameRow.style.display = "none";
    newPlayerInput.value = "";
    newPlayerBg.classList.add("show");
  }

  function findByName(nm) { return players.find(function (p) { return normName(p.name) === normName(nm); }); }
  function resolvePlayer(pick, cb) {
    if (pick.id) { cb(rosterOf(pick.id)); return; }
    var ex = findByName(pick.name);
    if (ex) { cb(ex); return; }
    dbInsertPlayer(pick.name, function (p) { cb(p); });
  }

  function applySeatChange(idx, pick) {
    resolvePlayer(pick, function (ref) {
      if (ref) state.seats[idx] = { id: ref.id, score: 0, log: [], done: false };
      newPlayerBg.classList.remove("show");
      pickMode = "round"; pickSeatIdx = -1;
      animateIn = true; vibrate(15); persist(); render();
      buildPlayers(); playersBg.classList.add("show");
      toast((ref ? ref.name : "اللاعب") + " قعد 🪑");
    });
  }

  function applyAllSwaps() {
    var idxs = Object.keys(swapNames);
    var step = function (k) {
      if (k >= idxs.length) {
        state.seats.forEach(function (s) { s.score = 0; s.log = []; s.done = false; });
        state.over = false;
        swapNames = {}; koozQueue = [];
        history = []; undoBtn.classList.add("disabled");
        animateIn = true; vibrate(20); persist(); render();
        toast("جولة جديدة 🔄");
        return;
      }
      var idx = parseInt(idxs[k], 10);
      resolvePlayer(swapNames[idx], function (ref) {
        if (ref) state.seats[idx] = { id: ref.id, score: 0, log: [], done: false };
        step(k + 1);
      });
    };
    step(0);
  }

  document.getElementById("showNewName").addEventListener("click", function () {
    newNameRow.style.display = "flex";
    setTimeout(function () { newPlayerInput.focus(); }, 100);
  });
  document.getElementById("newPlayerOk").addEventListener("click", doSwapNew);
  newPlayerInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doSwapNew(); });
  document.getElementById("newPlayerCancel").addEventListener("click", function () {
    newPlayerBg.classList.remove("show");
    if (pickMode === "single") { pickMode = "round"; pickSeatIdx = -1; playersBg.classList.add("show"); return; }
    koozQueue = []; swapNames = {};
    resultBg.classList.add("show");
  });

  document.getElementById("resClose").addEventListener("click", function () { resultBg.classList.remove("show"); });

  document.getElementById("resShare").addEventListener("click", function () {
    var r = lastResult;
    var lines = ["🎲 لعبة طرابيش — نتيجة الجولة", "🚬 الكوز: " + r.koozNames.join(" و "), "———"];
    r.snap.forEach(function (p, i) { lines.push((p.isKing ? "👑 " : ar(i + 1) + ". ") + p.name + " — " + ar(p.score)); });
    shareText(lines.join("\n"));
  });

  /* ===== نتايج الجلسة ===== */
  var sessionBg = document.getElementById("sessionBg");
  function buildSession() {
    document.getElementById("sessSub").textContent = "إجمالي كل القعدات · " + ar(players.length) + " لاعب";
    var seated = seatedIds();
    var ordered = players.slice().sort(function (a, b) { return (b.kings - a.kings) || (a.koozes - b.koozes); });
    var list = document.getElementById("sessList");
    list.innerHTML = "";
    ordered.forEach(function (p, r) {
      var onTable = seated.indexOf(p.id) >= 0;
      var champ = r === 0 && p.kings > 0;
      var row = document.createElement("div");
      row.className = "res-row clickable" + (champ ? " king-row" : "") + (onTable ? " seated-row" : "");
      var badge = onTable ? " 🪑" : "";
      row.innerHTML =
        '<div class="res-rank">' + (champ ? "🏆" : ar(r + 1)) + '</div>' +
        '<div class="res-name">' + escapeHtml(p.name) + badge + '</div>' +
        '<div class="res-tally">كنج ' + ar(p.kings) + ' · كوز ' + ar(p.koozes) + '</div>';
      row.addEventListener("click", function () { sessionBg.classList.remove("show"); openProfile(p.id); });
      list.appendChild(row);
    });
  }
  document.getElementById("sessionBtn").addEventListener("click", function () { buildSession(); sessionBg.classList.add("show"); });
  document.getElementById("sessClose").addEventListener("click", function () { sessionBg.classList.remove("show"); });
  document.getElementById("sessShare").addEventListener("click", shareSessionImage);

  /* ===== شاشة إدارة اللاعبين ===== */
  var playersBg = document.getElementById("playersBg");
  function buildPlayers() {
    var seated = seatedIds();
    var seatsBox = document.getElementById("pmSeats");
    seatsBox.innerHTML = "";
    state.seats.forEach(function (s, i) {
      var p = rosterOf(s.id) || { name: "?", kings: 0, koozes: 0 };
      var row = document.createElement("div");
      row.className = "pm-row seated";
      row.innerHTML =
        '<div class="pm-meta clickable"><span class="pm-name">🪑 ' + escapeHtml(p.name) + '</span>' +
        '<span class="pm-tally">كنج ' + ar(p.kings) + ' · كوز ' + ar(p.koozes) + '</span></div>';
      row.querySelector(".pm-meta").addEventListener("click", function () { playersBg.classList.remove("show"); openProfile(s.id); });
      var btn = document.createElement("button");
      btn.className = "pm-act"; btn.textContent = "غيّر";
      btn.addEventListener("click", function () {
        if (!amController()) { toast("لازم تكون المتحكم"); return; }
        playersBg.classList.remove("show");
        openSeatChange(i);
      });
      row.appendChild(btn);
      seatsBox.appendChild(row);
    });
    var bankBox = document.getElementById("pmBank");
    bankBox.innerHTML = "";
    var bank = players.filter(function (p) { return seated.indexOf(p.id) < 0; })
      .sort(function (a, b) { return (b.kings - a.kings) || (a.koozes - b.koozes); });
    if (!bank.length) { bankBox.innerHTML = '<div class="pm-bank-empty">كل اللاعبين على الطاولة دلوقتي</div>'; }
    bank.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "pm-row";
      row.innerHTML =
        '<div class="pm-meta clickable"><span class="pm-name">' + escapeHtml(p.name) + '</span>' +
        '<span class="pm-tally">كنج ' + ar(p.kings) + ' · كوز ' + ar(p.koozes) + '</span></div>';
      row.querySelector(".pm-meta").addEventListener("click", function () { playersBg.classList.remove("show"); openProfile(p.id); });
      var del = document.createElement("button");
      del.className = "pm-act"; del.textContent = "🗑️";
      del.addEventListener("click", function () { removeFromBank(p); });
      row.appendChild(del);
      bankBox.appendChild(row);
    });
  }

  function addToBank() {
    if (!amController()) { toast("لازم تكون المتحكم"); return; }
    var inp = document.getElementById("pmNewName");
    var nm = normName(inp.value);
    if (!nm) { inp.focus(); return; }
    if (findByName(nm)) { toast("الاسم موجود بالفعل"); inp.value = ""; return; }
    dbInsertPlayer(nm, function () {
      inp.value = ""; vibrate(15); buildPlayers();
      toast(nm + " اتضاف للبنك · اضغط «غيّر» على أي كرسي تقعّده");
    });
  }

  function removeFromBank(p) {
    if (!amController()) { toast("لازم تكون المتحكم"); return; }
    openSheet("تمسح " + p.name + "؟", "هيتشال من البنك نهائياً بكل إحصائياته. مش هينفع ترجع.", function () {
      dbDeletePlayer(p.id, function () { vibrate(20); buildPlayers(); toast("اتمسح"); });
    });
  }

  document.getElementById("playersBtn").addEventListener("click", function () { buildPlayers(); playersBg.classList.add("show"); });
  document.getElementById("pmClose").addEventListener("click", function () { playersBg.classList.remove("show"); });
  document.getElementById("pmAdd").addEventListener("click", addToBank);
  document.getElementById("pmNewName").addEventListener("keydown", function (e) { if (e.key === "Enter") addToBank(); });
  document.getElementById("pmWipe").addEventListener("click", function () {
    if (!amController()) { toast("لازم تكون المتحكم"); return; }
    openSheet("تصفير الإحصائيات؟", "هيرجّع كل الكنج والكوز لكل اللاعبين لصفر. الأسامي هتفضل. مش هينفع ترجع.", function () {
      players.forEach(function (r) { r.kings = 0; r.koozes = 0; dbUpdatePlayer(r); });
      store.savePlayers(players);
      vibrate(25); buildPlayers(); render();
      toast("اتصفّرت الإحصائيات");
    });
  });

  /* ===== صفحة اللاعب ===== */
  var profileBg = document.getElementById("profileBg");
  function relTime(iso) {
    try {
      var d = new Date(iso), now = new Date();
      var days = Math.floor((now - d) / 86400000);
      if (days <= 0) return "النهاردة";
      if (days === 1) return "إمبارح";
      if (days < 7) return "من " + days + " أيام";
      if (days < 30) return "من " + Math.floor(days / 7) + " أسابيع";
      return d.toLocaleDateString("ar-EG");
    } catch (e) { return ""; }
  }
  function openProfile(id) {
    var p = rosterOf(id);
    if (!p) return;
    document.getElementById("profName").textContent = p.name;
    document.getElementById("profSub").textContent = "إحصائيات اللاعب";
    var total = p.kings + p.koozes;
    var rate = total ? Math.round((p.kings / total) * 100) : 0;
    document.getElementById("profStats").innerHTML =
      '<div class="prof-stat gold"><div class="pv">' + ar(p.kings) + '</div><div class="pl">👑 كنج</div></div>' +
      '<div class="prof-stat red"><div class="pv">' + ar(p.koozes) + '</div><div class="pl">🚬 كوز</div></div>' +
      '<div class="prof-stat"><div class="pv">' + ar(rate) + '%</div><div class="pl">نسبة الكنج</div></div>' +
      '<div class="prof-stat" id="profStreak"><div class="pv">…</div><div class="pl">أطول سلسلة كنج</div></div>';
    var extra = document.getElementById("profExtra");
    extra.innerHTML = '<div class="prof-empty">بحمّل التفاصيل…</div>';
    profileBg.classList.add("show");

    dbPlayerResults(id, function (events) {
      var streak = 0, best = 0, last = null, nem = {};
      events.forEach(function (e) {
        if (e.kind === "king") { streak++; if (streak > best) best = streak; }
        else { streak = 0; (e.table_ids || []).forEach(function (tid) { if (tid !== id) nem[tid] = (nem[tid] || 0) + 1; }); }
        last = e;
      });
      var st = document.getElementById("profStreak");
      if (st) st.innerHTML = '<div class="pv">' + ar(best) + '</div><div class="pl">أطول سلسلة كنج</div>';

      if (!events.length) { extra.innerHTML = '<div class="prof-empty">التفاصيل (السلسلة، الخصم اللدود، آخر نتيجة) هتظهر بعد ما تلعبوا جولات جديدة.</div>'; return; }

      var lines = "";
      if (last) lines += '<div class="prof-line"><span class="k">آخر نتيجة</span><span>' + (last.kind === "king" ? "👑 كنج" : "🚬 كوز") + " · " + relTime(last.created_at) + '</span></div>';
      var nemId = null, nemMax = 0;
      Object.keys(nem).forEach(function (k) { if (nem[k] > nemMax) { nemMax = nem[k]; nemId = k; } });
      if (nemId) {
        var np = rosterOf(nemId);
        if (np) lines += '<div class="prof-line"><span class="k">الخصم اللدود 👀</span><span>' + escapeHtml(np.name) + " (" + ar(nemMax) + " كوز قدامه)</span></div>";
      }
      lines += '<div class="prof-line"><span class="k">إجمالي الجولات المسجّلة</span><span>' + ar(events.length) + '</span></div>';
      extra.innerHTML = lines;
    });
  }
  document.getElementById("profClose").addEventListener("click", function () { profileBg.classList.remove("show"); });

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shareSessionImage() {
    var seated = seatedIds();
    var ordered = players.slice().sort(function (a, b) { return (b.kings - a.kings) || (a.koozes - b.koozes); });
    var draw = function () {
      var W = 760, rowH = 78, gap = 12, top = 200, bottom = 56;
      var H = top + ordered.length * rowH + bottom;
      var c = document.createElement("canvas"); c.width = W; c.height = H;
      var x = c.getContext("2d");
      x.fillStyle = "#1a1310"; x.fillRect(0, 0, W, H);
      x.direction = "rtl";

      x.textAlign = "center";
      x.fillStyle = "#f5c451"; x.font = "900 48px Tajawal, sans-serif";
      x.fillText("🏆 لعبة طرابيش", W / 2, 84);
      x.fillStyle = "#9a8472"; x.font = "700 26px Tajawal, sans-serif";
      x.fillText("نتايج الجلسة · " + state.rounds + " جولة", W / 2, 128);
      x.strokeStyle = "#3d2e22"; x.lineWidth = 2;
      x.beginPath(); x.moveTo(40, 162); x.lineTo(W - 40, 162); x.stroke();

      ordered.forEach(function (p, i) {
        var onTable = seated.indexOf(p.id) >= 0;
        var champ = i === 0 && p.kings > 0;
        var y = top + i * rowH;
        var h = rowH - gap;
        x.fillStyle = champ ? "rgba(245,196,81,0.12)" : "#2c2018";
        roundRectPath(x, 30, y, W - 60, h, 18); x.fill();
        if (champ) { x.strokeStyle = "#f5c451"; x.lineWidth = 2; x.stroke(); }
        else if (onTable) { x.strokeStyle = "#7fae6b"; x.lineWidth = 2; x.stroke(); }

        var cy = y + h / 2 + 11;
        x.textAlign = "right";
        x.fillStyle = champ ? "#f5c451" : "#888"; x.font = "800 26px Tajawal, sans-serif";
        x.fillText(champ ? "🏆" : (i + 1) + "", W - 56, cy);
        x.fillStyle = "#f4e9dd"; x.font = "800 30px Tajawal, sans-serif";
        x.fillText(p.name + (onTable ? "" : " 🚪"), W - 110, cy);

        x.textAlign = "left";
        x.fillStyle = "#9a8472"; x.font = "700 24px Tajawal, sans-serif";
        x.fillText("كنج " + p.kings + " · كوز " + p.koozes, 56, cy);
      });

      c.toBlob(function (blob) {
        if (!blob) { toast("تعذّر إنشاء الصورة"); return; }
        var file = new File([blob], "tarabish.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "نتايج طرابيش" }).catch(function () {});
          return;
        }
        var url = URL.createObjectURL(blob);
        var win = window.open(url, "_blank");
        if (win) { toast("الصورة فتحت — دوس عليها مطوّل واحفظها"); }
        else {
          var a = document.createElement("a"); a.href = url; a.download = "tarabish.png";
          document.body.appendChild(a); a.click(); a.remove();
          toast("اتحمّلت الصورة 📷");
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
      }, "image/png");
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw).catch(draw);
    else draw();
  }

  function shareText(text) {
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast("اتنسخت ✓ الصقها في الواتساب"); }).catch(function () {});
    else toast("المشاركة مش متاحة هنا");
  }

  /* ===== وضع التحكم (واحد بس يتحكم) ===== */
  var modeBar = document.getElementById("modeBar");
  var modeLabel = document.getElementById("modeLabel");
  var modeBtn = document.getElementById("modeBtn");

  function updateModeBar() {
    var iAm = amController();
    var locked = lockedByOther();
    document.body.classList.toggle("viewer", !iAm);
    if (modeBar) {
      modeBar.classList.toggle("is-controller", iAm);
      modeBar.classList.toggle("is-locked", !iAm && locked);
    }
    if (iAm) {
      modeLabel.textContent = "🎮 أنت المتحكم";
      modeBtn.textContent = "🚪 اخرج من التحكم";
      modeBtn.classList.remove("disabled");
    } else if (locked) {
      modeLabel.textContent = "🔒 التحكم مع لاعب تاني";
      modeBtn.textContent = "🔒 مشغول";
      modeBtn.classList.add("disabled");
    } else {
      modeLabel.textContent = "👀 وضع المشاهدة";
      modeBtn.textContent = "🔓 دخول التحكم";
      modeBtn.classList.remove("disabled");
    }
    refreshUndo();
  }

  function tryTakeControl(code) {
    if (code !== CODE) { toast("الكود غلط ❌"); vibrate(30); return; }
    if (lockedByOther()) { toast("فيه حد ماسك التحكم دلوقتي · لازم يسيبه الأول"); vibrate(30); return; }
    state.controller = myToken;
    state.controllerAt = Date.now();
    vibrate(20); persist(); render();
    flashClass(document.getElementById("modeBar"), "flash", 520);
    toast("بقيت المتحكم 🎮");
  }
  function releaseControl() {
    if (!amController()) return;
    state.controller = "";
    state.controllerAt = 0;
    vibrate(15); persist(); render();
    toast("خرجت من التحكم 👀");
  }
  modeBtn.addEventListener("click", function () {
    if (modeBtn.classList.contains("disabled")) return;
    if (amController()) releaseControl();
    else openKeypad(-1, "code");
  });
  setInterval(updateModeBar, 3000);

  /* ===== سجل عمليات اللاعب (الجولة الحالية) ===== */
  var histBg = document.getElementById("histBg");
  function openHistory(i) {
    var seat = state.seats[i];
    document.getElementById("histTitle").textContent = "🧾 " + nameOf(seat);
    var list = document.getElementById("histList");
    list.innerHTML = "";
    var logs = seat.log || [];
    if (!logs.length) {
      list.innerHTML = '<div class="res-row" style="justify-content:center;color:var(--muted)">لسه مفيش عمليات في الجولة دي</div>';
    } else {
      logs.forEach(function (e) {
        var row = document.createElement("div");
        row.className = "res-row hist-row";
        var opHtml, cls = "";
        if (e.op === "set") { opHtml = "✏️ " + e.v; }
        else { var pos = e.d > 0; cls = pos ? "pos" : "neg"; opHtml = (pos ? "+" : "−") + Math.abs(e.d); }
        var d = new Date(e.t);
        var hh = ("0" + d.getHours()).slice(-2), mm = ("0" + d.getMinutes()).slice(-2);
        row.innerHTML =
          '<div class="hist-op ' + cls + '">' + opHtml + '</div>' +
          '<div class="hist-time">' + hh + ":" + mm + '</div>' +
          '<div class="hist-total">= ' + e.total + '</div>';
        list.appendChild(row);
      });
    }
    document.getElementById("histTotal").textContent = "الإجمالي: " + seat.score;
    histBg.classList.add("show");
  }
  document.getElementById("histClose").addEventListener("click", function () { histBg.classList.remove("show"); });

  /* ===== التوست ===== */
  var toastEl = document.getElementById("toast"), toastT = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 1900);
  }

  /* ===== المزامنة اللايف مع Supabase ===== */
  var SUPA_URL = "https://xqwrgstzmedcukptevps.supabase.co";
  var SUPA_KEY = "sb_publishable_nJXqZKoec1ZTUOmE72hDIw_J8M3TIgm";
  var ROW_ID = 1;

  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;

  var syncDot = document.getElementById("syncDot");
  function setStatus(cls) { if (syncDot) syncDot.className = "sync " + cls; }

  var lastWritten = "";      // آخر حاجة احنا كتبناها (عشان نتجاهل صدى تعديلنا)
  var lastLocalEditAt = 0;   // وقت آخر تعديل محلي (يكسب على السيرفر مؤقتاً)
  var pushTimer = null;
  var pendingRemote = null;  // تعديل جالك من بره بس مستني لحظة مناسبة

  function isBusy() {
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("name")) return true;
    var anyOpen = document.querySelector(".sheet-bg.show, .full-bg.show");
    return !(!anyOpen);
  }

  function pushRemote() {
    if (!sb) { setStatus("off"); return; }
    if (amController()) state.controllerAt = Date.now();
    lastLocalEditAt = Date.now();
    pendingRemote = null;
    var json = JSON.stringify(state);
    lastWritten = json;
    setStatus("saving");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      sb.from("game").update({ state: state }).eq("id", ROW_ID).then(function (res) {
        if (res.error) setStatus("off"); else setStatus("live");
      });
    }, 250);
  }

  function applyRemote(remote) {
    if (!remote || !remote.seats) return;
    // وأنا المتحكم ونسخة السيرفر لسه شايفاني المتحكم → نسختي المحلية هي الأصل،
    // تجاهل أي صدى قديم ممكن يرجّع نقاطي ويخليني أسجّلها تاني.
    if (amController() && (!remote.controller || remote.controller === myToken)) { setStatus("live"); return; }
    var json = JSON.stringify(remote);
    if (json === JSON.stringify(state)) { setStatus("live"); return; }
    if (json === lastWritten) { setStatus("live"); return; }
    if (Date.now() - lastLocalEditAt < 2000) { setStatus("live"); return; }
    if (isBusy()) { pendingRemote = remote; return; }
    state = remote;
    store.save(state);
    history = []; undoBtn.classList.add("disabled");
    render();
    setStatus("live");
  }

  function flushPending() {
    if (pendingRemote && !isBusy()) { var r = pendingRemote; pendingRemote = null; applyRemote(r); }
  }
  setInterval(flushPending, 600);

  function loadRemote(cb) {
    if (!sb) { cb(null); return; }
    sb.from("game").select("state").eq("id", ROW_ID).single().then(function (res) {
      if (res.error || !res.data) { setStatus("off"); cb(null); }
      else { cb(res.data.state); }
    });
  }

  /* ===== جدول اللاعبين الدائم ===== */
  function loadPlayers(cb) {
    if (!sb) { cb && cb(false); return; }
    sb.from("players").select("*").order("kings", { ascending: false }).then(function (res) {
      if (res.error) { toast("محتاج تعمل جدول players في Supabase"); cb && cb(false); return; }
      players = (res.data || []).map(function (r) { return { id: r.id, name: r.name, kings: r.kings || 0, koozes: r.koozes || 0 }; });
      store.savePlayers(players);
      cb && cb(true);
    });
  }
  function dbInsertPlayer(name, cb) {
    if (!sb) { var local = { id: "loc_" + Date.now(), name: name, kings: 0, koozes: 0 }; players.push(local); store.savePlayers(players); cb && cb(local); return; }
    sb.from("players").insert({ name: name, kings: 0, koozes: 0 }).select().single().then(function (res) {
      if (res.error || !res.data) { toast("تعذّر إضافة اللاعب"); cb && cb(null); return; }
      var p = { id: res.data.id, name: res.data.name, kings: res.data.kings || 0, koozes: res.data.koozes || 0 };
      if (!rosterOf(p.id)) players.push(p);
      store.savePlayers(players);
      cb && cb(p);
    });
  }
  var updTimers = {};
  function dbUpdatePlayer(p) {
    if (!sb || !p) return;
    store.savePlayers(players);
    clearTimeout(updTimers[p.id]);
    updTimers[p.id] = setTimeout(function () {
      sb.from("players").update({ name: p.name, kings: p.kings, koozes: p.koozes }).eq("id", p.id).then(function () {});
    }, 200);
  }
  function dbDeletePlayer(id, cb) {
    players = players.filter(function (p) { return p.id !== id; });
    store.savePlayers(players);
    if (!sb) { cb && cb(); return; }
    sb.from("players").delete().eq("id", id).then(function () { cb && cb(); });
  }
  function dbLogResult(playerId, kind, score, tableIds) {
    if (!sb || !playerId) return;
    sb.from("results").insert({ player_id: playerId, kind: kind, score: score, table_ids: tableIds }).then(function () {});
  }
  function dbPlayerResults(playerId, cb) {
    if (!sb) { cb([]); return; }
    sb.from("results").select("*").eq("player_id", playerId).order("created_at", { ascending: true }).then(function (res) {
      if (res.error || !res.data) { cb([]); return; }
      cb(res.data);
    });
  }
  function migrateFromRoster(remote, done) {
    var roster = (remote && remote.roster) || [];
    var byName = {};
    roster.forEach(function (r) {
      var key = normName(r.name);
      if (!byName[key]) byName[key] = { name: r.name, kings: 0, koozes: 0, oldIds: [] };
      byName[key].kings += (r.kings || 0);
      byName[key].koozes += (r.koozes || 0);
      byName[key].oldIds.push(r.id);
    });
    var merged = Object.keys(byName).map(function (k) { return byName[k]; });
    if (!merged.length) { seedDefaults(done); return; }
    sb.from("players").insert(merged.map(function (m) { return { name: m.name, kings: m.kings, koozes: m.koozes }; })).select().then(function (res) {
      if (res.error || !res.data) { toast("تعذّر نقل اللاعبين"); seedDefaults(done); return; }
      players = res.data.map(function (r) { return { id: r.id, name: r.name, kings: r.kings || 0, koozes: r.koozes || 0 }; });
      store.savePlayers(players);
      var map = {};
      merged.forEach(function (m) { var np = findByName(m.name); if (np) m.oldIds.forEach(function (oid) { map[oid] = np.id; }); });
      var seats = (remote.seats || []).map(function (s) {
        var nid = map[s.id] || (players[0] && players[0].id);
        return { id: nid, score: s.score || 0, log: s.log || [], done: !(!s.done) };
      });
      while (seats.length < SEATS && players[seats.length]) seats.push({ id: players[seats.length].id, score: 0, log: [], done: false });
      state = { target: remote.target || 300, rounds: remote.rounds || 0, over: false, controller: "", controllerAt: 0, seats: seats };
      store.save(state); pushRemote(); render(); done && done();
    });
  }
  function seedDefaults(done) {
    var defs = ["شريف", "كريم", "حسني", "حفظي"];
    sb.from("players").insert(defs.map(function (n) { return { name: n, kings: 0, koozes: 0 }; })).select().then(function (res) {
      if (res.error || !res.data) { toast("تعذّر إنشاء اللاعبين"); done && done(); return; }
      players = res.data.map(function (r) { return { id: r.id, name: r.name, kings: r.kings || 0, koozes: r.koozes || 0 }; });
      store.savePlayers(players);
      var seats = players.slice(0, SEATS).map(function (p) { return { id: p.id, score: 0, log: [], done: false }; });
      state = { target: state.target || 300, rounds: 0, over: false, controller: "", controllerAt: 0, seats: seats };
      store.save(state); pushRemote(); render(); done && done();
    });
  }
  function seatsValid(remote) {
    return remote && remote.seats && remote.seats.length === SEATS && remote.seats.every(function (s) { return rosterOf(s.id); });
  }

  function startSync() {
    if (!sb) { setStatus("off"); return; }
    loadPlayers(function (ok) {
      loadRemote(function (remote) {
        if (players.length === 0) {
          if (remote && remote.roster && remote.roster.length) migrateFromRoster(remote, function () { setStatus("live"); });
          else seedDefaults(function () { setStatus("live"); });
        } else if (seatsValid(remote)) {
          state = remote; store.save(state); render(); setStatus("live");
        } else {
          var seats = players.slice(0, SEATS).map(function (p) { return { id: p.id, score: 0, log: [], done: false }; });
          state = { target: (remote && remote.target) || state.target || 300, rounds: (remote && remote.rounds) || 0, over: false, controller: "", controllerAt: 0, seats: seats };
          store.save(state); pushRemote(); render(); setStatus("live");
        }
      });
    });

    try {
      sb.channel("game-live")
        .on("postgres_changes",
          { event: "UPDATE", schema: "public", table: "game", filter: "id=eq." + ROW_ID },
          function (payload) { if (payload && payload.new) applyRemote(payload.new.state); })
        .subscribe(function (status) { if (status === "SUBSCRIBED") setStatus("live"); });
    } catch (e) {}

    try {
      sb.channel("players-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "players" }, function () {
          loadPlayers(function () {
            if (isBusy()) return;
            render();
            if (sessionBg.classList.contains("show")) buildSession();
            if (playersBg.classList.contains("show")) buildPlayers();
          });
        }).subscribe();
    } catch (e) {}

    // الـ realtime channel بيغطّي التحديثات الحيّة؛ ده مجرد احتياطي.
    // نوقفه وقت ما التطبيق في الخلفية عشان نوفّر بطارية كل اللاعبين وكوتة Supabase.
    setInterval(function () { if (!document.hidden) loadRemote(function (r) { applyRemote(r); }); }, 2500);
    setInterval(function () { if (amController()) pushRemote(); }, 12000);   // نبضة قفل التحكم — تفضل شغّالة عشان متفقدش التحكم وانت مفتح
  }

  render();
  startSync();

  /* ===== شاشة مسح القطع بالكاميرا (العد التلقائي الآمن) ===== */
  var scanBg = document.getElementById("scanBg");
  var scanVideo = document.getElementById("scanVideo");
  var scanCanvas = document.getElementById("scanCanvas");
  var scanShutter = document.getElementById("scanShutter");
  var scanResult = document.getElementById("scanResult");
  var scanHint = document.getElementById("scanHint");
  var notifBar = document.getElementById("notifBar");
  var scanOverlay = document.getElementById("scanOverlay");
  var scanLiveTotal = document.getElementById("scanLiveTotal");
  var scanLiveNum = document.getElementById("scanLiveNum");
  var scanStream = null;
  var pendingScan = null;

  // محرّك الكشف اللحظي (موديل على الجهاز): بيشتغل لايف ويقفل القراءة لمّا تثبت.
  var detector = null;
  var detectorReady = false;
  function syncScanHint() {
    if (detector && !detectorReady && detector.backend !== "mock") {
      scanHint.textContent = "⏳ بحمّل العدّاد لأول مرة… ثانية";
    } else if (detector && detector.backend === "mock") {
      scanHint.textContent = "🧪 نتايج تجريبية — وجّه على القطع";
    } else {
      scanHint.textContent = "وجّه الكاميرا على القطع وثبّت شوية";
    }
  }
  var scanLive = false, scanRAF = 0, scanInflight = false, scanLastInfer = 0, scanLocked = false;
  var scanRecent = [];                 // آخر كام قراءة عشان نتأكد إنها ثابتة قبل القفل
  var SCAN_INTERVAL_MS = 80;           // أسرع ما يقدر الجهاز (~12 لقطة/ث) — الرقم يتحدّث لحظياً.
                                       // single-flight بيمنع التكدّس، فعلياً بيحدّه زمن الاستدلال نفسه.
  var SCAN_STABLE_FRAMES = 3;          // لازم نفس المجموع 3 مرات (~ثانية) قبل القفل
  var SCAN_MIN_CONF = 0.62;            // ثقة أقل من كده = لسه بيدوّر

  // بنحمّل الموديل ونسخّنه في الخلفية أول ما التطبيق يفتح (مش أول ما الكاميرا تفتح):
  // تحميل TF.js + الموديل + ترجمة شيدرز WebGL بياخدوا ثواني، ولو حصلوا والكاميرا
  // شغّالة بيهنّجوا الصورة — فبنخلّصهم بدري وأول فتح للماسح يبقى فوري وسلس.
  function preloadDetector() {
    if (detector) return;
    if (!window.DominoPipTracker && !window.DominoDetector) return;
    detector = (window.DominoPipTracker || window.DominoDetector).create();
    detector.ready.then(function () {
      detectorReady = true;
      if (scanBg.classList.contains("show")) syncScanHint();
    });
  }
  (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(preloadDetector);

  document.getElementById("scanBtn").addEventListener("click", openScan);

  // السيرفر المجاني على Render بينام بعد ~15 دقيقة، وأول طلب بياخد ~30 ثانية يصحى.
  // بنبعتله نبضة خفيفة بدري — أول ما التطبيق يفتح، ولمّا يرجع للواجهة، ولمّا الكاميرا تتفتح —
  // عشان يبقى صاحي قبل ما اللاعب يضغط يصوّر، فالنتيجة تطلع على طول.
  var lastWarm = 0;
  function warmServer() {
    var now = Date.now();
    if (now - lastWarm < 60000) return; // مرة كل دقيقة على الأكثر
    lastWarm = now;
    try { fetch("/api/warmup", { method: "GET", cache: "no-store" }).catch(function () {}); } catch (e) {}
  }
  warmServer();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") warmServer();
  });

  function openScan() {
    // PipTracker YOLOv5 model (MIT, Ricky Hartmann) يشتغل بالكامل على الجهاز عبر TensorFlow.js
    preloadDetector();                                          // غالباً محمّل خلاص من الخلفية — دي مجرد ضمانة
    warmServer();                                               // نخلّي السيرفر صاحي عشان تحميل الموديل والصفحة يبقى سريع
    scanResult.style.display = "none";
    scanShutter.style.display = "none";                         // مفيش زرار تصوير — القفل تلقائي
    scanLiveTotal.style.display = "none";
    scanLiveTotal.classList.remove("locked");
    syncScanHint();
    scanBg.classList.add("show");
    startCamera();
    try { scanVideo.play(); } catch (e) {}
    startScanLoop();
  }

  function startCamera() {
    if (scanStream) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (stream) { scanStream = stream; scanVideo.srcObject = stream; })
      .catch(function () { toast("مش قادر يفتح الكاميرا — تأكد إنك ديت الإذن"); closeScan(); });
  }

  function closeScan() {
    stopScanLoop();
    if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
    scanVideo.srcObject = null;
    scanBg.classList.remove("show");
    scanShutter.classList.remove("scan-processing");
  }

  document.getElementById("scanClose").addEventListener("click", closeScan);

  /* ===== محرّك الكشف اللحظي ===== */
  function startScanLoop() {
    scanLocked = false;
    scanLive = true;
    scanRecent = [];
    prevScanBoxes = [];
    scanLastInfer = 0;
    scanLiveTotal.classList.remove("locked");
    ovBoxes = []; ovLocked = false;
    startOverlay();
    if (scanRAF) cancelAnimationFrame(scanRAF);
    scanRAF = requestAnimationFrame(scanTick);
  }
  function stopScanLoop() {
    scanLive = false;
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = 0; }
    stopOverlay();
  }
  function scanTick(ts) {
    if (!scanLive) return;
    scanRAF = requestAnimationFrame(scanTick);
    if (!detectorReady) return;                        // الموديل لسه بيتجهّز — مانبعتش فريمات تهنّج الكاميرا
    if (scanInflight) return;                          // single-flight: قطعة واحدة في المرة
    if (ts - scanLastInfer < SCAN_INTERVAL_MS) return; // كبح لـ ~3 لقطات/ثانية
    scanLastInfer = ts;
    var frame = grabScanFrame();                       // اللقطة الحالية (مقصوصة زي اللي ظاهر)
    scanInflight = true;
    detector.detect(frame).then(function (res) {
      scanInflight = false;
      if (scanLive) onScanDetect(res);
    }).catch(function () { scanInflight = false; });
  }

  // ناخد بس الجزء الظاهر من الفيديو (object-fit: cover) ونصغّره للموديل.
  function grabScanFrame() {
    var vw = scanVideo.videoWidth, vh = scanVideo.videoHeight;
    if (!vw || !vh) return null;
    var rect = scanVideo.getBoundingClientRect();
    var dispW = rect.width || vw, dispH = rect.height || vh;
    var scale = Math.max(dispW / vw, dispH / vh);
    var sw = dispW / scale, sh = dispH / scale, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    var LONG = 480, aspect = dispW / dispH;
    var outW = aspect >= 1 ? LONG : Math.round(LONG * aspect);
    var outH = aspect >= 1 ? Math.round(LONG / aspect) : LONG;
    scanCanvas.width = outW; scanCanvas.height = outH;
    scanCanvas.getContext("2d").drawImage(scanVideo, sx, sy, sw, sh, 0, 0, outW, outH);
    return scanCanvas;
  }

  // فلتر الاستمرارية: الصندوق لازم يظهر في لقطتين متتاليتين (نفس المكان ونفس الرقم)
  // قبل ما يتحسب — بيقتل الومضات الكاذبة اللي بتطلع لحظياً على الخلفيات المزخرفة.
  var prevScanBoxes = [];
  function boxOverlap(a, b) {
    var ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ix <= 0 || iy <= 0) return 0;
    var inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter);
  }
  function persistentBoxes(boxes) {
    var prev = prevScanBoxes;
    prevScanBoxes = boxes;
    return boxes.filter(function (b) {
      return prev.some(function (p) { return p.cls === b.cls && boxOverlap(p, b) > 0.3; });
    });
  }

  function onScanDetect(res) {
    var boxes = persistentBoxes(res.boxes || []);
    var total = boxes.reduce(function (s, b) { return s + b.cls; }, 0);
    var conf = boxes.length ? boxes.reduce(function (s, b) { return s + b.conf; }, 0) / boxes.length : 0;

    // اكتمال القراءة: الموديل الجديد بيكشف القطعة كلها كمان (مش بس الأنصاص).
    // كل قطعة لازم يبان فيها نصّين بالظبط قبل ما نقفل — عشان مانقفلش على قراءة
    // ناقصة (زي ما كان بيحصل لما نص يتفوّت). الموديل القديم (tiles=null) بيعدي.
    var complete = true;
    if (res.tiles) {
      complete = res.tiles.length > 0 && boxes.length === res.tiles.length * 2;
      if (!complete && res.tiles.length > 0) {
        scanHint.textContent = "في نص قطعة مش باين — عدّل الزاوية شوية";
      }
    }

    // عدّاد تاني مستقل: بنعدّ النقط الغامقة في كل نص بتحليل البيكسلات نفسها،
    // والقفل مايتمّش غير لما العدّادين يتفقوا على كل نص (يمنع غلطات زي ٣ تتقري ٥).
    var allVerified = boxes.every(function (b) { return b.verified !== false; });
    if (complete && !allVerified) {
      scanHint.textContent = "بيتأكد من عدّ النقط — ثبّت أو قرّب شوية";
    }

    updateOverlayTargets(boxes, false);
    scanLiveTotal.style.display = "block";
    scanLiveNum.textContent = ar(total);

    // ثبات: نفس المجموع SCAN_STABLE_FRAMES مرات متتالية + ثقة كفاية + مجموع > 0
    scanRecent.push({ total: total, conf: conf, complete: complete, verified: allVerified });
    if (scanRecent.length > SCAN_STABLE_FRAMES) scanRecent.shift();
    if (scanRecent.length === SCAN_STABLE_FRAMES) {
      var first = scanRecent[0].total;
      var allSame = scanRecent.every(function (r) { return r.total === first; });
      var allComplete = scanRecent.every(function (r) { return r.complete; });
      var allOk = scanRecent.every(function (r) { return r.verified; });
      var meanConf = scanRecent.reduce(function (s, r) { return s + r.conf; }, 0) / scanRecent.length;
      if (allSame && allComplete && allOk && first > 0 && meanConf >= SCAN_MIN_CONF) lockScanReading({ boxes: boxes, total: total, conf: conf });
    }
  }

  function lockScanReading(res) {
    scanLocked = true;
    scanLive = false;
    if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = 0; }   // وقّف الكشف لتوفير البطارية
    updateOverlayTargets(res.boxes, true);                         // صناديق خضرا = اتأكدنا (طبقة الرسم شغّالة لسه)
    scanLiveTotal.classList.add("locked");
    scanLiveNum.textContent = ar(res.total);
    vibrate([20, 40, 20]);
    showScanResult(res.total, pairTilesForDisplay(res.boxes));
  }

  /* ===== رسم الصناديق: طبقة متحركة 60fps =====
     الكشف بيحصل كل ~300ms، فلو رسمنا نتايجه مباشرةً الصناديق "بتنطّ". بدل كده
     الكشف بيحدّث "أهداف"، وحلقة رسم منفصلة بتزحلق كل صندوق نحو هدفه بنعومة،
     مع ظهور/اختفاء تدريجي وأقواس زوايا بدل إطار مصمت — شكل ماسح احترافي. */
  var ovBoxes = [];                    // حالة العرض المتحركة لكل صندوق
  var ovLocked = false, ovRAF = 0, ovLockAt = 0;

  function updateOverlayTargets(boxes, locked) {
    ovLocked = locked;
    if (locked) ovLockAt = performance.now();
    ovBoxes.forEach(function (st) { st.matched = false; });
    (boxes || []).forEach(function (b) {
      // نطابق كل كشف جديد بأقرب صندوق معروض من نفس الرقم عشان يتحرّك له بدل ما يترسم من أول
      var best = -1, bestOv = 0.2;
      for (var i = 0; i < ovBoxes.length; i++) {
        if (ovBoxes[i].matched || ovBoxes[i].cls !== b.cls) continue;
        var ov = boxOverlap(ovBoxes[i], b);
        if (ov > bestOv) { bestOv = ov; best = i; }
      }
      if (best >= 0) {
        var st = ovBoxes[best];
        st.matched = true; st.verified = b.verified;
        st.tx = b.x; st.ty = b.y; st.tw = b.w; st.th = b.h; st.ta = 1;
      } else {
        ovBoxes.push({ cls: b.cls, verified: b.verified,
                       x: b.x, y: b.y, w: b.w, h: b.h,
                       tx: b.x, ty: b.y, tw: b.w, th: b.h,
                       a: 0, ta: 1, s: 0.88, matched: true });
      }
    });
    ovBoxes.forEach(function (st) { if (!st.matched) st.ta = 0; });   // اختفى من الكشف → يتلاشى
  }

  function startOverlay() {
    if (!ovRAF) ovRAF = requestAnimationFrame(overlayLoop);
  }
  function stopOverlay() {
    if (ovRAF) { cancelAnimationFrame(ovRAF); ovRAF = 0; }
    ovBoxes = []; ovLocked = false;
    var ctx = scanOverlay.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, scanOverlay.width, scanOverlay.height);
  }

  function overlayLoop() {
    ovRAF = requestAnimationFrame(overlayLoop);
    var rect = scanVideo.getBoundingClientRect();
    var W = rect.width, H = rect.height, dpr = window.devicePixelRatio || 1;
    if (!W || !H) return;
    if (scanOverlay.width !== Math.round(W * dpr) || scanOverlay.height !== Math.round(H * dpr)) {
      scanOverlay.width = Math.round(W * dpr); scanOverlay.height = Math.round(H * dpr);
    }
    var ctx = scanOverlay.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // نبضة خفيفة لحظة القفل بتدّي إحساس "تمّ" من غير ما تلهي
    var pulse = ovLocked ? 1 + Math.max(0, 1 - (performance.now() - ovLockAt) / 260) * 0.05 : 1;
    for (var i = ovBoxes.length - 1; i >= 0; i--) {
      var st = ovBoxes[i];
      st.x += (st.tx - st.x) * 0.22; st.y += (st.ty - st.y) * 0.22;
      st.w += (st.tw - st.w) * 0.22; st.h += (st.th - st.h) * 0.22;
      st.a += (st.ta - st.a) * 0.25; st.s += (1 - st.s) * 0.2;
      if (st.ta === 0 && st.a < 0.04) { ovBoxes.splice(i, 1); continue; }
      drawBracketBox(ctx, st, W, H, pulse);
    }
  }

  function drawBracketBox(ctx, st, W, H, pulse) {
    var w = st.w * W * st.s * pulse, h = st.h * H * st.s * pulse;
    var cx = (st.x + st.w / 2) * W, cyc = (st.y + st.h / 2) * H;
    var x = cx - w / 2, y = cyc - h / 2;
    var col = ovLocked ? "#9ed47f" : (st.verified === false ? "#e8b34f" : "rgba(255,255,255,.92)");
    ctx.globalAlpha = st.a;
    ctx.fillStyle = ovLocked ? "rgba(133,180,110,.13)" : "rgba(255,255,255,.045)";
    roundRectPath(ctx, x, y, w, h, 10); ctx.fill();
    // أقواس الزوايا الأربعة بدل إطار كامل
    var L = Math.min(w, h) * 0.26, r = Math.min(10, L * 0.6);
    ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.strokeStyle = col;
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(x, y + L); ctx.arcTo(x, y, x + L, y, r); ctx.lineTo(x + L, y);
    ctx.moveTo(x + w - L, y); ctx.arcTo(x + w, y, x + w, y + L, r); ctx.lineTo(x + w, y + L);
    ctx.moveTo(x + w, y + h - L); ctx.arcTo(x + w, y + h, x + w - L, y + h, r); ctx.lineTo(x + w - L, y + h);
    ctx.moveTo(x + L, y + h); ctx.arcTo(x, y + h, x, y + h - L, r); ctx.lineTo(x, y + h - L);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // شارة الرقم: دايرة زجاجية فوق منتصف الضلع العلوي (كهرماني = العدّاد البيكسلي لسه مش موافق)
    var R = 13;
    ctx.fillStyle = ovLocked ? "rgba(95,146,67,.95)"
      : (st.verified === false ? "rgba(181,116,42,.92)" : "rgba(12,10,7,.78)");
    ctx.beginPath(); ctx.arc(cx, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath(); ctx.arc(cx, y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "800 14px Tajawal, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(ar(st.cls), cx, y + 0.5);
    ctx.globalAlpha = 1;
  }

  // نقرّن الأنصاف لأقرب نص تاني عشان نعرضها «5|6» (للعرض بس — المجموع مش محتاج تقرين).
  function pairTilesForDisplay(boxes) {
    var rem = (boxes || []).map(function (b) {
      return { cls: b.cls, cx: b.x + b.w / 2, cy: b.y + b.h / 2, sz: Math.max(b.w, b.h), used: false };
    });
    var tiles = [];
    for (var i = 0; i < rem.length; i++) {
      if (rem[i].used) continue;
      rem[i].used = true;
      // نصّين بتوع نفس القطعة مركزهم على بُعد ~حجم النص؛ فالعتبة نسبية لحجم القطعة.
      var lim = 1.5 * rem[i].sz, bestD = lim * lim, best = -1;
      for (var j = i + 1; j < rem.length; j++) {
        if (rem[j].used) continue;
        var dx = rem[i].cx - rem[j].cx, dy = rem[i].cy - rem[j].cy, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0) { rem[best].used = true; tiles.push(rem[i].cls + "|" + rem[best].cls); }
      else tiles.push(String(rem[i].cls));
    }
    return tiles;
  }

  function showScanResult(total, tiles) {
    document.getElementById("scanTotal").textContent = ar(total);
    document.getElementById("scanDetail").textContent = tiles && tiles.length ? tiles.join("  ·  ") : "";
    pendingScan = { total: total };
    scanResult.style.display = "flex";
    vibrate([20, 50, 20]);
  }

  document.getElementById("scanRetry").addEventListener("click", function () {
    scanResult.style.display = "none";
    scanLiveTotal.classList.remove("locked");
    scanHint.textContent = detector && detector.backend === "mock"
      ? "🧪 نتايج تجريبية — وجّه على القطع تاني"
      : "وجّه الكاميرا على القطع وثبّت شوية";
    try { scanVideo.play(); } catch (e) {}
    pendingScan = null;
    startScanLoop();                        // رجّع الكشف اللحظي للقراءة من جديد
  });

  // قناة بث مباشرة لاقتراحات المسح — بتبعت الرقم بس من غير ما تكتب الحالة كلها،
  // عشان نسخة اللاعب القديمة متبوّظش نقاط المتحكم (ده اللي كان بيخلّي السكور يتسجّل مرتين).
  var scanChannel = null, scanChannelJoined = false;
  function setupScanChannel() {
    if (!sb) return;
    if (scanChannel) { try { sb.removeChannel(scanChannel); } catch (e) {} }
    scanChannelJoined = false;
    // ack:false = أطلق وانسَ (مانستناش رد السيرفر) عشان الإرسال يطلع أسرع.
    scanChannel = sb.channel("scan-suggest", { config: { broadcast: { self: false, ack: false } } });
    scanChannel.on("broadcast", { event: "scan" }, function (msg) {
      var p = msg && msg.payload;
      if (!p || typeof p.total !== "number") return;
      if (p.from === myToken) return;   // مش اقتراحي أنا
      if (!amController()) return;      // المتحكم بس اللي يستقبل الاقتراح
      showScanSuggestion(p);
    }).subscribe(function (status) {
      scanChannelJoined = (status === "SUBSCRIBED");
    });
  }
  setupScanChannel();
  // الموبايل بيسيّب الـ websocket يموت لما الشاشة تطفّى أو التطبيق يروح للخلفية،
  // وأول رسالة بعد ما يصحى بتستنّى إعادة اتصال (أو تضيع، فاللاعب يبعت تاني = "بتتأخّر").
  // نعيد الاشتراك أول ما الشاشة ترجع قدّام عشان قناة المتحكم تفضل حيّة دايماً.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && sb && (!scanChannel || scanChannel.state !== "joined")) {
      setupScanChannel();
    }
  });

  function showScanSuggestion(p) {
    notifBar.style.display = "flex";
    var who = p.name ? " لـ " + p.name : "";
    document.getElementById("notifText").textContent = "📷 اقتراح نقاط" + who + ": " + ar(p.total);
    notifBar._suggestion = p;
    vibrate([30, 60, 30]);
  }

  // اللاعب يختار هو بيصوّر لمين قبل ما يبعت — عشان المتحكم يعرف الخانة الصح.
  var recipientBg = null;
  function ensureRecipientPicker() {
    if (recipientBg) return recipientBg;
    recipientBg = document.createElement("div");
    recipientBg.className = "sheet-bg";
    recipientBg.style.zIndex = "70"; // فوق شاشة الكاميرا (.full-bg = 60) عشان يبان ويتضغط
    recipientBg.innerHTML =
      '<div class="sheet">' +
        '<h3 style="text-align:center">مين اللاعب اللي اتصوّر؟</h3>' +
        '<div id="recipientRow" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0"></div>' +
        '<div class="sheet-actions"><button class="btn-cancel" id="recipientCancel">إلغاء</button></div>' +
      '</div>';
    document.body.appendChild(recipientBg);
    recipientBg.addEventListener("click", function (e) { if (e.target === recipientBg) recipientBg.classList.remove("show"); });
    recipientBg.querySelector("#recipientCancel").addEventListener("click", function () { recipientBg.classList.remove("show"); });
    return recipientBg;
  }

  function chooseScanRecipient(total) {
    var bg = ensureRecipientPicker();
    var row = bg.querySelector("#recipientRow");
    row.innerHTML = "";
    state.seats.forEach(function (s, i) {
      var b = document.createElement("button");
      b.className = "pick-btn";
      b.innerHTML = '<span>' + escapeHtml(nameOf(s)) + '</span><span class="s">' + ar(s.score) + '</span>';
      b.addEventListener("click", function () { bg.classList.remove("show"); sendScanSuggestion(total, i); });
      row.appendChild(b);
    });
    bg.classList.add("show");
  }

  function sendScanSuggestion(total, seatIdx) {
    var seat = state.seats[seatIdx];
    if (!sb) { toast("المزامنة مقفولة — مش قادر أبعت للمتحكم دلوقتي"); closeScan(); pendingScan = null; return; }
    var payload = {
      total: total,
      seatId: seat ? seat.id : null,
      seatIdx: seatIdx,
      name: seat ? nameOf(seat) : "",
      from: myToken,
      at: Date.now()
    };
    function fire() { scanChannel.send({ type: "broadcast", event: "scan", payload: payload }); }
    if (scanChannel && scanChannelJoined) {
      fire();                                   // القناة حيّة → يوصل فوراً
      toast("اتبعت للمتحكم ✓");
    } else {
      // القناة لسه بتتصل (رجعنا من الخلفية مثلاً) — نجهّزها ونبعت أول ما تجهز،
      // بدل ما الرسالة تتبعت على قناة ميتة وتضيع.
      setupScanChannel();
      var tries = 0, iv = setInterval(function () {
        if (scanChannelJoined) { fire(); clearInterval(iv); }
        else if (++tries > 15) { clearInterval(iv); toast("الاتصال ضعيف — جرّب تبعت تاني"); }
      }, 120);
      toast("اتبعت للمتحكم ✓");
    }
    closeScan();
    pendingScan = null;
  }

  document.getElementById("scanSend").addEventListener("click", function () {
    if (!pendingScan) return;
    chooseScanRecipient(pendingScan.total);
  });

  // يفتح الكيباد وهو متعبّي بالرقم فعلاً (مش مجرد عرض) عشان OK يزوّد من أول ضغطة.
  function prefillKeypad(i, value) {
    openKeypad(i, "add");
    kpVal = String(value);
    refreshKp();
  }

  document.getElementById("notifAdd").addEventListener("click", function () {
    if (!amController()) return;
    var sug = notifBar._suggestion;
    notifBar.style.display = "none";
    if (!sug || typeof sug.total !== "number") return;
    // افتح خانة اللاعب اللي اللاعب اختاره: بالـ id الأول، وإلا بالترتيب، وإلا أول واحد لسه ماخدش دوره.
    var target = -1;
    if (sug.seatId) target = state.seats.findIndex(function (s) { return s.id === sug.seatId; });
    if (target < 0 && typeof sug.seatIdx === "number" && sug.seatIdx >= 0 && sug.seatIdx < state.seats.length) target = sug.seatIdx;
    if (target < 0) target = state.seats.findIndex(function (s) { return !s.done; });
    if (target < 0) target = 0;
    prefillKeypad(target, sug.total);
  });

  document.getElementById("notifDismiss").addEventListener("click", function () {
    notifBar.style.display = "none";
  });
})();
