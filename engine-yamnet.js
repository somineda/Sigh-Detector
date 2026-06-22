"use strict";

// 학습 불필요 버전: 구글 사전학습 모델 YAMNet(AudioSet 521클래스, 'Sigh' 포함)을
// MediaPipe Tasks Audio로 브라우저에서 직접 구동. 마이크 → 1초 윈도우 → 분류 → 'Sigh' 점수.
import { AudioClassifier, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@0.10.35/audio_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@0.10.35/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";

const toggleBtn = document.getElementById("toggleListen");
const keywordInput = document.getElementById("keyword");

let classifier = null;
let listening = false;
let audioCtx = null, stream = null, source = null, processor = null, zeroGain = null;
let ring = null, ringSize = 0, writePos = 0, filled = 0, timer = null;
let keywords = parseKeywords(keywordInput && keywordInput.value);

function parseKeywords(str) {
  const list = (str || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ["sigh"];
}

SighUI.init({ tuneKey: "sigh:tune:yamnet", defaultThreshold: 0.15 });
SighUI.setTargetName((keywordInput && keywordInput.value.trim()) || "Sigh");
SighUI.setStatus("준비 완료 — [감지 시작]을 누르면 마이크로 바로 감지해 (학습 불필요)", "idle");

if (keywordInput) {
  keywordInput.addEventListener("change", () => {
    keywords = parseKeywords(keywordInput.value);
    SighUI.setTargetName(keywordInput.value.trim() || "Sigh");
  });
}

async function ensureClassifier() {
  if (classifier) return classifier;
  SighUI.setStatus("사전학습 모델 불러오는 중... (최초 1회, ~4MB)", "idle");
  const fileset = await FilesetResolver.forAudioTasks(WASM);
  classifier = await AudioClassifier.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL },
    // runningMode 기본값 AUDIO_CLIPS — 1초 윈도우를 반복 분류(스테이트리스)
  });
  return classifier;
}

async function start() {
  try {
    await ensureClassifier();
    // noiseSuppression은 반드시 끔 — 한숨(숨소리=노이즈성)이 지워질 수 있음
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaStreamSource(stream);
    const sr = audioCtx.sampleRate;
    ringSize = Math.ceil(sr * 1.0);          // YAMNet 프레임 0.975s → 1초 윈도우
    ring = new Float32Array(ringSize); writePos = 0; filled = 0;

    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) { ring[writePos] = input[i]; writePos = (writePos + 1) % ringSize; }
      if (filled < ringSize) filled = Math.min(ringSize, filled + input.length);
    };
    zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0; // 스피커로 새어나가지 않게(에코 방지)
    source.connect(processor); processor.connect(zeroGain); zeroGain.connect(audioCtx.destination);

    timer = setInterval(classifyTick, 400);  // 0.4초마다 최근 1초 분류
    listening = true;
    toggleBtn.textContent = "⏹ 감지 중지"; toggleBtn.classList.add("on");
    SighUI.setStatus("👂 감지 중... (마이크 활성화됨)", "ok");
  } catch (err) {
    console.error(err);
    SighUI.setStatus("시작 실패: " + err.message + " — 마이크 권한 & HTTPS/localhost 확인", "err");
    stop();
  }
}

function classifyTick() {
  if (!classifier || filled < ringSize) return;
  const buf = new Float32Array(ringSize);
  let idx = writePos;                         // 가장 오래된 샘플부터 시간순으로 정렬
  for (let i = 0; i < ringSize; i++) { buf[i] = ring[idx]; idx = (idx + 1) % ringSize; }
  let results;
  try { results = classifier.classify(buf, audioCtx.sampleRate); }
  catch (err) { console.error(err); return; }
  if (!results || !results.length) return;
  const cats = results[results.length - 1].classifications[0].categories;
  if (cats.length) SighUI.setHint(`지금: ${cats[0].categoryName} ${Math.round(cats[0].score * 100)}%`);
  const matched = cats.filter((c) => keywords.some((k) => c.categoryName.toLowerCase().includes(k)));
  SighUI.feedScore(matched.length ? Math.max(...matched.map((c) => c.score)) : 0);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  try { processor && processor.disconnect(); } catch (e) {}
  try { zeroGain && zeroGain.disconnect(); } catch (e) {}
  try { source && source.disconnect(); } catch (e) {}
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  processor = source = zeroGain = null;
  listening = false;
  toggleBtn.textContent = "▶ 감지 시작"; toggleBtn.classList.remove("on");
  SighUI.updateMeter(0);
  if (classifier) SighUI.setStatus("감지 중지됨", "idle");
}

toggleBtn.addEventListener("click", () => { listening ? stop() : start(); });
