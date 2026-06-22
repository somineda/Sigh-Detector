"use strict";

/* 두 버전(YAMNet 학습0 / Teachable Machine 학습)이 공유하는 UI·저장·카운트 로직.
   엔진은 SighUI.feedScore(0~1 점수)만 호출하면 미터·임계값·쿨다운·카운트·그래프가 자동 처리됨. */
const SighUI = (function () {
  const ids = ["status", "meterFill", "meterPct", "targetName", "hint", "count",
    "counterCard", "reaction", "logList", "chart", "total", "threshold", "thresholdVal",
    "cooldown", "cooldownVal", "resetBtn", "shareBtn", "setupToggle", "setupBody"];
  const els = {};
  ids.forEach((id) => { els[id] = document.getElementById(id); });

  const COUNTS = "sigh:counts";   // 두 버전 공유
  const LOG = "sigh:log";         // 두 버전 공유
  let tuneKey = "sigh:tune";      // 민감도/쿨다운/음소거는 엔진별로 분리
  let threshold = 0.6, cooldownMs = 2500, defaultThreshold = 0.6;
  let lastSighTime = 0;

  const REACTIONS = ["또...?", "괜찮으세요...?", "후... 😮‍💨", "오늘도 시작됐다",
    "한숨 적립 +1", "에너지 방출 감지", "🫠 녹는 중", "하아아~ 포착"];

  // ---- storage ----
  const load = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? f : v; } catch { return f; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayKey = () => dateKey(new Date());

  // ---- ui bits ----
  function setStatus(msg, kind) { els.status.textContent = msg; els.status.className = "status " + (kind || "idle"); }
  function setHint(text) { if (els.hint) els.hint.textContent = text; }
  function setTargetName(name) { if (els.targetName) els.targetName.textContent = name; }
  function updateMeter(score) {
    const pct = Math.round(score * 100);
    els.meterFill.style.width = pct + "%";
    els.meterPct.textContent = pct + "%";
    els.meterFill.classList.toggle("hot", score >= threshold);
  }
  function flash() {
    els.counterCard.classList.remove("flash"); void els.counterCard.offsetWidth; els.counterCard.classList.add("flash");
    els.reaction.textContent = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
    els.reaction.classList.remove("show"); void els.reaction.offsetWidth; els.reaction.classList.add("show");
  }

  // ---- render ----
  function renderCount() { els.count.textContent = (load(COUNTS, {})[todayKey()]) || 0; }
  function renderLog() {
    const arr = (load(LOG, {})[todayKey()] || []).slice().reverse().slice(0, 8);
    els.logList.innerHTML = arr.length === 0 ? '<li class="empty">아직 기록 없음</li>'
      : arr.map((ts) => {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0"), ss = String(d.getSeconds()).padStart(2, "0");
        return `<li><span class="dot"></span>${hh}:${mm}:${ss}<span class="tag">한숨 감지</span></li>`;
      }).join("");
  }
  function renderChart() {
    const counts = load(COUNTS, {}), today = new Date(), days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      days.push({ label: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`, count: counts[dateKey(d)] || 0, isToday: i === 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.count));
    els.chart.innerHTML = days.map((d) => {
      const h = Math.max(Math.round((d.count / max) * 100), d.count > 0 ? 8 : 2);
      return `<div class="bar-col"><div class="bar-val">${d.count}</div><div class="bar" style="height:${h}%"></div><div class="bar-label${d.isToday ? " today" : ""}">${d.label}</div></div>`;
    }).join("");
    els.total.textContent = Object.values(counts).reduce((a, b) => a + b, 0);
  }

  // ---- detection core ----
  function registerSigh() {
    const key = todayKey();
    const counts = load(COUNTS, {}); counts[key] = (counts[key] || 0) + 1; save(COUNTS, counts);
    const logs = load(LOG, {}); const arr = logs[key] || []; arr.push(Date.now()); logs[key] = arr.slice(-50); save(LOG, logs);
    renderCount(); renderLog(); renderChart(); flash();
  }
  function feedScore(score) {
    if (typeof score !== "number" || isNaN(score)) score = 0;
    updateMeter(score);
    const now = Date.now();
    if (score >= threshold && now - lastSighTime > cooldownMs) { lastSighTime = now; registerSigh(); return true; }
    return false;
  }

  // ---- tuning persistence ----
  function saveTune() { save(tuneKey, { threshold, cooldownMs }); }
  function restoreTune() {
    const s = load(tuneKey, {});
    threshold = typeof s.threshold === "number" ? s.threshold : defaultThreshold;
    cooldownMs = typeof s.cooldownMs === "number" ? s.cooldownMs : 2500;
    els.threshold.value = Math.round(threshold * 100);
    els.thresholdVal.textContent = Math.round(threshold * 100) + "%";
    els.cooldown.value = cooldownMs;
    els.cooldownVal.textContent = (cooldownMs / 1000).toFixed(1) + "초";
  }

  function wireCommon() {
    els.threshold.addEventListener("input", () => {
      threshold = Number(els.threshold.value) / 100; els.thresholdVal.textContent = els.threshold.value + "%"; saveTune();
    });
    els.cooldown.addEventListener("input", () => {
      cooldownMs = Number(els.cooldown.value); els.cooldownVal.textContent = (cooldownMs / 1000).toFixed(1) + "초"; saveTune();
    });
    els.setupToggle && els.setupToggle.addEventListener("click", () => {
      const willOpen = els.setupBody.hidden; els.setupBody.hidden = !willOpen; els.setupToggle.setAttribute("aria-expanded", String(willOpen));
    });
    els.shareBtn.addEventListener("click", async () => {
      const n = (load(COUNTS, {})[todayKey()]) || 0;
      const text = `📊 오늘 한숨 ${n}회 적립 🫠 #한숨탐지기`;
      try { await navigator.clipboard.writeText(text); setStatus("클립보드에 복사됨 → " + text, "ok"); } catch { setStatus(text, "idle"); }
    });
    els.resetBtn.addEventListener("click", () => {
      if (!confirm("오늘 포함 모든 한숨 기록을 지울까? (설정은 유지)")) return;
      save(COUNTS, {}); save(LOG, {}); renderCount(); renderLog(); renderChart(); setStatus("기록 초기화 완료", "idle");
    });
  }

  function init(opts) {
    opts = opts || {};
    tuneKey = opts.tuneKey || "sigh:tune";
    defaultThreshold = typeof opts.defaultThreshold === "number" ? opts.defaultThreshold : 0.6;
    restoreTune(); wireCommon(); renderCount(); renderLog(); renderChart();
  }

  return { init, feedScore, updateMeter, setStatus, setHint, setTargetName, els };
})();
window.SighUI = SighUI; // ES모듈(engine-yamnet.js)에서 전역 접근 보장
