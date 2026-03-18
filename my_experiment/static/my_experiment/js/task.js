// my_experiment/static/my_experiment/js/task.js
import { EXPERIMENT, SNACKS } from "./config.js";
import { buildTrials } from "./trialgen.js";
import { downloadCSV } from "./export.js";

const $ = (id) => document.getElementById(id);

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

const FASTER_MS = 2000;

const snackById = new Map(SNACKS.map((s) => [s.id, s]));

const statusEl = $("status");
const fixationEl = $("fixation");
const choiceEl = $("choice");
const fasterEl = $("faster");
const endEl = $("end");
const mainHintEl = $("mainHint");
const timerEl = $("timer");
const downloadBtn = $("downloadBtn");
const nextBtn = document.getElementById("nextBtn");
const hiddenJson = document.getElementById("choiceDataJson");

const leftImg = $("leftImg");
const rightImg = $("rightImg");
const leftLabel = $("leftLabel");
const rightLabel = $("rightLabel");

const phase = localStorage.getItem("phase") || "practice";
const isReal = phase === "real";

const allTrials = buildTrials();
const PRACTICE_N = Math.min(
  Number(EXPERIMENT.PRACTICE_BINARY_TRIALS ?? 5),
  allTrials.length
);

const practiceTrials = allTrials.slice(0, PRACTICE_N);
const mainTrials = allTrials.slice(PRACTICE_N);

// practice phase: only practice
// real phase: only main
let isPracticeBlock = !isReal;
let trials = isReal ? mainTrials : practiceTrials;

const rows = [];

let trialIndex = -1;
let awaitingResponse = false;
let trialStartPerf = null;
let timeoutHandle = null;
let countdownHandle = null;

function show(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.style.display = "";
}

function hide(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.style.display = "none";
}
function setNextEnabled(enabled) {
  if (nextBtn) nextBtn.disabled = !enabled;
}

function setChoiceScreen(trial) {
  const L = snackById.get(trial.left_item_id);
  const R = snackById.get(trial.right_item_id);

  leftImg.src = L.img;
  rightImg.src = R.img;
  leftLabel.textContent = L.label;
  rightLabel.textContent = R.label;
}

function startCountdown() {
  if (timerEl) timerEl.textContent = "";
}

function cleanupTrialTimers() {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (countdownHandle) clearInterval(countdownHandle);
  timeoutHandle = null;
  countdownHandle = null;
}

function showFasterThenContinue() {
  hide(choiceEl);
  hide(fixationEl);
  if (timerEl) timerEl.textContent = "";

  show(fasterEl);

  setTimeout(() => {
    hide(fasterEl);
    show(fixationEl);
    setTimeout(() => {
      nextTrial();
    }, EXPERIMENT.ITI_MS);
  }, FASTER_MS);
}

function recordResponse({ chosen_item_id, is_timeout, advance = "normal" }) {
  if (!awaitingResponse) return;

  awaitingResponse = false;
  cleanupTrialTimers();

  const tEnd = performance.now();
  const rt_ms = is_timeout ? "" : Math.round(tEnd - trialStartPerf);
  const trial = trials[trialIndex];
  const phaseLabel = isPracticeBlock ? "practice" : "real";
  const timestampIso = new Date().toISOString();

  rows.push({
    subject_id,
    session_id,
    trial_index: trialIndex + 1,
    is_practice: isPracticeBlock ? 1 : 0,
    left_item_id: trial.left_item_id,
    right_item_id: trial.right_item_id,
    chosen_item_id: is_timeout ? "" : chosen_item_id,
    rt_ms,
    is_timeout: is_timeout ? 1 : 0,
    pair_id: trial.pair_id,
    timestamp: timestampIso,
  });

  // Live-save each trial with explicit phase so backend can dedup and export
  // practice/real rows independently.
  if (typeof liveSend === "function") {
    liveSend({
      type: "choice_trial",
      phase: phaseLabel,
      trial_index: trialIndex + 1,
      pair_id: trial.pair_id,
      left_item_id: trial.left_item_id,
      right_item_id: trial.right_item_id,
      chosen_item: is_timeout ? "" : chosen_item_id,
      rt_ms,
      is_timeout: !!is_timeout,
      timestamp_utc: timestampIso,
    });
  }

  hide(choiceEl);

  if (advance === "faster") {
    showFasterThenContinue();
  } else {
    show(fixationEl);
    setTimeout(nextTrial, EXPERIMENT.ITI_MS);
  }
}

function onKeyDown(e) {
  if (!awaitingResponse) return;

  if (e.key === EXPERIMENT.KEY_LEFT) {
    recordResponse({
      chosen_item_id: trials[trialIndex].left_item_id,
      is_timeout: false,
    });
  } else if (e.key === EXPERIMENT.KEY_RIGHT) {
    recordResponse({
      chosen_item_id: trials[trialIndex].right_item_id,
      is_timeout: false,
    });
  }
}

function finishPracticeOnly() {
  hide(fixationEl);
  hide(choiceEl);
  hide(fasterEl);
  show(endEl);

  if (statusEl) {
    statusEl.textContent = "Practice complete.";
  }

  const msg = document.createElement("div");
  msg.style.marginTop = "12px";
  msg.innerHTML = `
    <p>You have completed the practice trials.</p>
    <p>Click <strong>Next</strong> to continue.</p>
  `;
  endEl.innerHTML = "";
  endEl.appendChild(msg);

  const practiceRowsOut = rows.filter((r) => r.is_practice === 1);
  if (hiddenJson) hiddenJson.value = JSON.stringify(practiceRowsOut);
  show(nextBtn);
  setNextEnabled(true);
  window.removeEventListener("keydown", onKeyDown);
}

function finishRealTask() {
  hide(fixationEl);
  hide(choiceEl);
  hide(fasterEl);
  show(endEl);

  const mainRowsOut = rows.filter((r) => r.is_practice === 0);

  if (hiddenJson) {
    hiddenJson.value = JSON.stringify(mainRowsOut);
  }

  downloadBtn.onclick = () => {
    downloadCSV(mainRowsOut, `choice_subject_${subject_id}.csv`);
  };

  show(nextBtn);
  setNextEnabled(true);
  window.removeEventListener("keydown", onKeyDown);
}

function nextTrial() {
  hide(nextBtn);
  trialIndex += 1;

  if (trialIndex >= trials.length) {
    if (isPracticeBlock) {
      finishPracticeOnly();
    } else {
      finishRealTask();
    }
    return;
  }

  if (isPracticeBlock) {
    statusEl.textContent = `Practice: Trial ${trialIndex + 1} / ${trials.length}`;
    hide(mainHintEl);
  } else {
    statusEl.textContent = "";
    show(mainHintEl);
  }

  hide(fasterEl);
  show(fixationEl);
  hide(choiceEl);

  setTimeout(() => {
    hide(fixationEl);

    setChoiceScreen(trials[trialIndex]);
    show(choiceEl);

    awaitingResponse = true;
    trialStartPerf = performance.now();

    startCountdown();
    if (!isPracticeBlock && timerEl) timerEl.textContent = "";

    timeoutHandle = setTimeout(() => {
      const advance = isPracticeBlock ? "normal" : "faster";
      recordResponse({ chosen_item_id: null, is_timeout: true, advance });
    }, EXPERIMENT.MAX_RESPONSE_WINDOW_MS);
  }, EXPERIMENT.FIXATION_MS);
}

hide(nextBtn);
setNextEnabled(false);
window.addEventListener("keydown", onKeyDown);
nextTrial();