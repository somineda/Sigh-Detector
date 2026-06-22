"use strict";

// 정밀 버전: Teachable Machine에서 직접 학습한 모델(TF.js)로 감지. 정확도↑, 대신 녹음·학습 필요.
const modelUrlInput = document.getElementById("modelUrl");
const loadBtn = document.getElementById("loadBtn");
const labelRow = document.getElementById("labelRow");
const labelSelect = document.getElementById("labelSelect");
const toggleBtn = document.getElementById("toggleListen");

let recognizer = null, listening = false, targetIndex = -1;
const SETTINGS = "sigh:settings:tm";

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
    await recognizer.listen((result) => {
      if (!result.scores || targetIndex < 0) return;
      SighUI.feedScore(result.scores[targetIndex]);
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

// 저장된 모델 자동 로드(마이크는 시작 버튼 눌러야 켜짐)
(function () {
  const cfg = loadCfg();
  if (cfg.modelURL) { modelUrlInput.value = cfg.modelURL; SighUI.setStatus("저장된 모델 불러오는 중...", "idle"); loadModel(); }
  else SighUI.setStatus("① 모델 URL 입력 → ② 모델 불러오기 → ③ 감지 시작", "idle");
})();
