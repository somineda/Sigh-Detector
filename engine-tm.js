"use strict";

// 정밀 버전: Teachable Machine에서 직접 학습한 모델(TF.js)로 감지. 정확도↑, 대신 녹음·학습 필요.
const modelUrlInput = document.getElementById("modelUrl");
const loadBtn = document.getElementById("loadBtn");
const labelRow = document.getElementById("labelRow");
const labelSelect = document.getElementById("labelSelect");
const toggleBtn = document.getElementById("toggleListen");
const captureMemo = document.getElementById("captureMemo");
const captureBtn = document.getElementById("captureBtn");
const exportScores = document.getElementById("exportScores");
const clearScores = document.getElementById("clearScores");
const scoreLogEl = document.getElementById("scoreLog");

let recognizer = null, listening = false, targetIndex = -1;
let recent = [], labelsCache = [];
const SETTINGS = "sigh:settings:tm";
const SCORELOG = "sigh:scorelog";

SighUI.init({ tuneKey: "sigh:tune:tm", defaultThreshold: 0.75 });

function loadCfg() { try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; } }
function saveCfg() {
  localStorage.setItem(SETTINGS, JSON.stringify({ modelURL: modelUrlInput.value.trim(), targetLabel: labelSelect.value }));
}

async function loadModel() {
  const raw = modelUrlInput.value.trim();
  if (!raw) { SighUI.setStatus("Teachable Machine 모델 URL을 넣어줘", "warn"); return; }
  if (typeof speechCommands === "undefined") { SighUI.setStatus("라이브러리 로드 실패 — 인터넷 연결 확인", "err"); return; }
  const url = raw.endsWith("/") ? raw : raw + "/";
  loadBtn.disabled = true; loadBtn.textContent = "불러오는 중...";
  try {
    const rec = speechCommands.create("BROWSER_FFT", undefined, url + "model.json", url + "metadata.json");
    await rec.ensureModelLoaded();
    recognizer = rec;
    populateLabels(rec.wordLabels());
    saveCfg();
    SighUI.setStatus("✅ 모델 로드 완료! 라벨 확인하고 [감지 시작] 눌러", "ok");
  } catch (err) {
    console.error(err);
    SighUI.setStatus("모델 로드 실패 — URL 확인 (" + err.message + ")", "err");
  } finally {
    loadBtn.disabled = false; loadBtn.textContent = "모델 불러오기";
  }
}

function populateLabels(labels) {
  const cfg = loadCfg();
  labelSelect.innerHTML = labels.map((l) => `<option value="${l}">${l}</option>`).join("");
  let pick = labels.find((l) => l === cfg.targetLabel) || labels.find((l) => /한숨|sigh/i.test(l)) || labels[0];
  labelSelect.value = pick;
  targetIndex = labels.indexOf(pick);
  SighUI.setTargetName(pick);
  labelRow.hidden = false;
}

async function start() {
  if (!recognizer) { SighUI.setStatus("먼저 모델을 불러와줘 👆", "warn"); return; }
  if (targetIndex < 0) { SighUI.setStatus("감지할 라벨을 선택해줘", "warn"); return; }
  try {
    const labels = recognizer.wordLabels();
    labelsCache = labels;
    await recognizer.listen((result) => {
      if (!result.scores || targetIndex < 0) return;
      const now = Date.now();
      recent.push({ t: now, scores: Array.from(result.scores) });
      while (recent.length && recent[0].t < now - 1500) recent.shift();
      const top = labels.map((l, i) => ({ l, s: result.scores[i] }))
        .sort((a, b) => b.s - a.s).slice(0, 3)
        .map((p) => `${p.l} ${Math.round(p.s * 100)}%`);
      SighUI.setHint("지금: " + top.join(" · "));
      if (SighUI.feedScore(result.scores[targetIndex])) logSnapshot("감지됨");
    }, { includeSpectrogram: false, probabilityThreshold: 0, invokeCallbackOnNoiseAndUnknown: true, overlapFactor: 0.75 });
    listening = true;
    toggleBtn.textContent = "⏹ 감지 중지"; toggleBtn.classList.add("on");
    SighUI.setStatus("👂 감지 중... (마이크 활성화됨)", "ok");
  } catch (err) {
    console.error(err);
    SighUI.setStatus("마이크를 못 켰어: " + err.message + " — HTTPS/localhost & 권한 확인", "err");
  }
}

function stop() {
  if (recognizer && listening) { try { recognizer.stopListening(); } catch (e) {} }
  listening = false;
  toggleBtn.textContent = "▶ 감지 시작"; toggleBtn.classList.remove("on");
  SighUI.setStatus("감지 중지됨", "idle");
  SighUI.updateMeter(0);
}

loadBtn.addEventListener("click", loadModel);
labelSelect.addEventListener("change", () => {
  if (recognizer) targetIndex = recognizer.wordLabels().indexOf(labelSelect.value);
  SighUI.setTargetName(labelSelect.value); saveCfg();
});
toggleBtn.addEventListener("click", () => { listening ? stop() : start(); });

// ===== 점수 기록 (비교용) =====
function loadScoreLog() { try { return JSON.parse(localStorage.getItem(SCORELOG)) || []; } catch { return []; } }
function saveScoreLog(arr) { localStorage.setItem(SCORELOG, JSON.stringify(arr.slice(-100))); }
function peakSnapshot() {
  const peak = labelsCache.map(() => 0);
  recent.forEach((f) => f.scores.forEach((s, i) => { if (s > peak[i]) peak[i] = s; }));
  return peak;
}
function logSnapshot(memo) {
  if (!labelsCache.length || !recent.length) return;
  const peak = peakSnapshot();
  const arr = loadScoreLog();
  arr.push({ t: Date.now(), memo: memo || "", labels: labelsCache.slice(), scores: peak.map((s) => Math.round(s * 100)) });
  saveScoreLog(arr);
  renderScoreLog();
}
function renderScoreLog() {
  if (!scoreLogEl) return;
  const arr = loadScoreLog().slice().reverse();
  if (!arr.length) { scoreLogEl.innerHTML = '<p class="empty">기록 없음 — 소리 내고 [📸 현재 점수 기록]을 눌러봐 (한숨으로 감지될 때도 자동 기록됨)</p>'; return; }
  const labels = arr[0].labels || [];
  const head = "<tr><th>시간</th><th>메모</th>" + labels.map((l) => `<th>${l}</th>`).join("") + "</tr>";
  const rows = arr.map((e) => {
    const d = new Date(e.t);
    const tm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    return `<tr><td>${tm}</td><td>${e.memo || "-"}</td>${e.scores.map((v) => `<td>${v}%</td>`).join("")}</tr>`;
  }).join("");
  scoreLogEl.innerHTML = `<table class="stable">${head}${rows}</table>`;
}
function exportScoresCSV() {
  const arr = loadScoreLog();
  if (!arr.length) { SighUI.setStatus("기록이 없어", "warn"); return; }
  const labels = arr[arr.length - 1].labels || [];
  const header = ["time", "memo", ...labels].join(",");
  const lines = arr.map((e) => [new Date(e.t).toISOString(), `"${(e.memo || "").replace(/"/g, '""')}"`, ...e.scores].join(","));
  const blob = new Blob([header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "sigh-scores.csv"; a.click();
  URL.revokeObjectURL(url);
}
captureBtn && captureBtn.addEventListener("click", () => {
  if (!listening) { SighUI.setStatus("감지 중일 때 눌러줘 (소리 낸 직후)", "warn"); return; }
  logSnapshot(captureMemo ? captureMemo.value.trim() : "");
});
exportScores && exportScores.addEventListener("click", exportScoresCSV);
clearScores && clearScores.addEventListener("click", () => { if (confirm("점수 기록을 지울까?")) { saveScoreLog([]); renderScoreLog(); } });
renderScoreLog();

// 저장된 모델 자동 로드(마이크는 시작 버튼 눌러야 켜짐)
(function () {
  const cfg = loadCfg();
  if (cfg.modelURL) { modelUrlInput.value = cfg.modelURL; SighUI.setStatus("저장된 모델 불러오는 중...", "idle"); loadModel(); }
  else SighUI.setStatus("① 모델 URL 입력 → ② 모델 불러오기 → ③ 감지 시작", "idle");
})();
