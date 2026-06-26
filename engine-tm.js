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

// ===== 오탐 필터: 말소리가 1등이고 '한숨' 점수가 낮으면 무시 =====
// 근거(점수기록 분석): 진짜 한숨은 배경소음과 함께 높게 잡혀서 '배경소음 1등'은 제외하지 않음.
//                     반면 '말소리 1등' 프레임은 대부분 그냥 말한 것(오탐)이었음.
const FP_FILTER = true;        // 필터 끄려면 false
const FP_SIGH_BELOW = 0.50;    // 한숨 점수가 이 값 미만일 때만 무시 (이상이면 한숨으로 인정)
const SPEECH_RE = /말소리|말|speech|voice|talk/i;
function argmax(a) { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; }
function isSpeechFalsePositive(scores, labels) {
  if (!FP_FILTER) return false;
  const si = labels.findIndex((l) => SPEECH_RE.test(l));
  if (si < 0 || si === targetIndex) return false;   // 말소리 라벨이 없거나 타깃과 같으면 필터 비활성
  return argmax(scores) === si && scores[targetIndex] < FP_SIGH_BELOW;
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
      const sighScore = result.scores[targetIndex];
      if (isSpeechFalsePositive(result.scores, labels)) {
        SighUI.setHint("지금: " + top.join(" · ") + "  ·  ⏸ 말소리로 판단 → 무시");
        SighUI.updateMeter(sighScore);            // 미터만 갱신, 카운트는 안 함
      } else {
        SighUI.setHint("지금: " + top.join(" · "));
        if (SighUI.feedScore(sighScore)) logSnapshot("", "감지");
      }
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
function saveScoreLog(arr) { localStorage.setItem(SCORELOG, JSON.stringify(arr.slice(-200))); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function peakSnapshot() {
  const peak = labelsCache.map(() => 0);
  recent.forEach((f) => f.scores.forEach((s, i) => { if (s > peak[i]) peak[i] = s; }));
  return peak;
}
function logSnapshot(memo, kind) {
  if (!labelsCache.length || !recent.length) return;
  const peak = peakSnapshot();
  const arr = loadScoreLog();
  arr.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    t: Date.now(), kind: kind || "수동", memo: memo || "",
    labels: labelsCache.slice(), scores: peak.map((s) => Math.round(s * 100)),
  });
  saveScoreLog(arr);
  // 메모 입력 중이면 포커스 안 뺏기게 다시 그리지 않음 (데이터는 이미 저장됨)
  const a = document.activeElement;
  if (!(a && a.classList && a.classList.contains("memo-edit"))) renderScoreLog();
}
function updateMemo(id, memo) {
  const arr = loadScoreLog();
  const e = arr.find((x) => x.id === id);
  if (e) { e.memo = memo; saveScoreLog(arr); }
}
function renderScoreLog() {
  if (!scoreLogEl) return;
  const arr = loadScoreLog().slice().reverse();
  if (!arr.length) { scoreLogEl.innerHTML = '<p class="empty">기록 없음 — 한숨이 감지되면 자동 저장돼. [📸 현재 점수 기록]으로 직접 추가도 가능. 저장된 행은 메모/✅❌로 라벨링하세요.</p>'; return; }
  const labels = arr[0].labels || [];
  const head = "<tr><th>시간</th><th>종류</th><th>메모/라벨</th><th></th>" + labels.map((l) => `<th>${esc(l)}</th>`).join("") + "</tr>";
  const rows = arr.map((e) => {
    const d = new Date(e.t);
    const tm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    const cells = e.scores.map((v) => `<td>${v}%</td>`).join("");
    return `<tr>` +
      `<td>${tm}</td>` +
      `<td><span class="kind ${e.kind === "감지" ? "k-auto" : "k-man"}">${esc(e.kind)}</span></td>` +
      `<td><input class="memo-edit" data-id="${e.id}" value="${esc(e.memo)}" placeholder="진짜 한숨? 딴소리?" /></td>` +
      `<td class="tagbtns"><button data-id="${e.id}" data-tag="진짜 한숨" title="진짜 한숨">✅</button><button data-id="${e.id}" data-tag="딴소리" title="딴소리(오탐)">❌</button></td>` +
      cells + `</tr>`;
  }).join("");
  scoreLogEl.innerHTML = `<table class="stable">${head}${rows}</table>`;
}
function exportScoresCSV() {
  const arr = loadScoreLog();
  if (!arr.length) { SighUI.setStatus("기록이 없어", "warn"); return; }
  const labels = arr[arr.length - 1].labels || [];
  const header = ["time", "kind", "memo", ...labels].join(",");
  const lines = arr.map((e) => [new Date(e.t).toISOString(), e.kind, `"${(e.memo || "").replace(/"/g, '""')}"`, ...e.scores].join(","));
  const blob = new Blob(["﻿" + header + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" }); // BOM: 엑셀 한글
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "sigh-scores.csv"; a.click();
  URL.revokeObjectURL(url);
}
captureBtn && captureBtn.addEventListener("click", () => {
  if (!listening) { SighUI.setStatus("감지 중일 때 눌러줘 (소리 낸 직후)", "warn"); return; }
  logSnapshot(captureMemo ? captureMemo.value.trim() : "", "수동");
});
exportScores && exportScores.addEventListener("click", exportScoresCSV);
clearScores && clearScores.addEventListener("click", () => { if (confirm("점수 기록을 지울까?")) { saveScoreLog([]); renderScoreLog(); } });
scoreLogEl && scoreLogEl.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.classList && t.classList.contains("memo-edit")) updateMemo(t.dataset.id, t.value);
});
scoreLogEl && scoreLogEl.addEventListener("click", (ev) => {
  const b = ev.target.closest && ev.target.closest("button[data-tag]");
  if (b) { updateMemo(b.dataset.id, b.dataset.tag); renderScoreLog(); }
});
renderScoreLog();

// 저장된 모델 자동 로드(마이크는 시작 버튼 눌러야 켜짐)
(function () {
  const cfg = loadCfg();
  if (cfg.modelURL) { modelUrlInput.value = cfg.modelURL; SighUI.setStatus("저장된 모델 불러오는 중...", "idle"); loadModel(); }
  else SighUI.setStatus("① 모델 URL 입력 → ② 모델 불러오기 → ③ 감지 시작", "idle");
})();
