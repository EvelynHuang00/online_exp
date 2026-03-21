// my_experiment/static/my_experiment/js/task.js
import { EXPERIMENT, SNACKS, PRACTICE_SNACKS } from "./config.js";
import { buildTrials } from "./trialgen.js";
import { downloadCSV } from "./export.js";

const $ = (id) => document.getElementById(id);

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

const FASTER_MS = 2000;

function resolvePhase() {
  let src = null;
  const root = document.getElementById("taskApp");
  if (root && root.dataset && root.dataset.phase) {
    src = root.dataset.phase;
  } else if (typeof window !== "undefined" && window.__TASK_PHASE__) {
    src = window.__TASK_PHASE__;
  } else {
    try {
      src = localStorage.getItem("phase");
    } catch (e) {}
  }

  let phaseValue = (src || "practice").toString().toLowerCase();
  if (phaseValue !== "real") {
    phaseValue = "practice";
  }

  try {
    localStorage.setItem("phase", phaseValue);
  } catch (e) {}

  return phaseValue;
}

function resolvePracticeCycle() {
  let value = 1;
  const root = document.getElementById("taskApp");
  if (root && root.dataset && root.dataset.practiceCycle) {
    value = Number(root.dataset.practiceCycle);
  } else if (typeof window !== "undefined" && window.__PRACTICE_CYCLE__ != null) {
    value = Number(window.__PRACTICE_CYCLE__);
  }

  if (!Number.isFinite(value) || value < 1) {
    value = 1;
  }

  return Math.floor(value);
}

const phase = resolvePhase();
const practiceCycle = resolvePracticeCycle();
const isReal = phase === "real";
const activeSnacks = isReal ? SNACKS : PRACTICE_SNACKS;

const snackById = new Map(activeSnacks.map((s) => [s.id, s]));

const statusEl = $("status");
const fixationEl = $("fixation");
const choiceEl = $("choice");
const fasterEl = $("faster");
const mainHintEl = $("mainHint");
const timerEl = $("timer");
const downloadBtn = $("downloadBtn");
const nextBtn = document.getElementById("nextBtn");
const hiddenJson = document.getElementById("choiceDataJson");

const leftImg = $("leftImg");
const rightImg = $("rightImg");
const leftLabel = $("leftLabel");
const rightLabel = $("rightLabel");

const allTrials = buildTrials(activeSnacks);
const PRACTICE_N = isReal
  ? 0
  : Math.min(Number(EXPERIMENT.PRACTICE_BINARY_TRIALS ?? 5), allTrials.length);

const practiceTrials = allTrials.slice(0, PRACTICE_N);
const mainTrials = allTrials.slice(PRACTICE_N);

// practice phase: only practice
// real phase: only main
let isPracticeBlock = !isReal;
let trials = isReal ? mainTrials : practiceTrials;

// Store the actual number of trials for display purposes
const practiceTrialCount = practiceTrials.length;
const mainTrialCount = mainTrials.length;

console.log(`[Task Init] Phase: ${phase}, cycle: ${practiceCycle}, isReal: ${isReal}, isPracticeBlock: ${isPracticeBlock}, activeSnacks: ${activeSnacks.length}, allTrials: ${allTrials.length}, practiceTrials: ${practiceTrialCount}, mainTrials: ${mainTrialCount}, trials: ${trials.length}`);

const rows = [];

window.liveRecv = function (data) {
  if (!data || typeof data !== "object") return;
  if (data.ok) {
    if (data.saved) {
      console.debug("[liveRecv] Trial saved");
    } else if (data.dedup) {
      console.debug("[liveRecv] Duplicate trial ignored");
    }
  }
};

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

  if (!L) {
    console.error(`[setChoiceScreen] Left snack not found: ${trial.left_item_id}. Available snacks:`, Array.from(snackById.keys()));
    return false;
  }
  if (!R) {
    console.error(`[setChoiceScreen] Right snack not found: ${trial.right_item_id}. Available snacks:`, Array.from(snackById.keys()));
    return false;
  }

  try {
    leftImg.src = L.img;
    rightImg.src = R.img;
    leftLabel.textContent = L.label;
    rightLabel.textContent = R.label;
    console.log(`[setChoiceScreen] Loaded trial ${trialIndex + 1}: ${trial.left_item_id} vs ${trial.right_item_id}`);
    return true;
  } catch (e) {
    console.error(`[setChoiceScreen] Error setting display:`, e);
    return false;
  }
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
    practice_cycle: isPracticeBlock ? practiceCycle : 1,
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
      practice_cycle: isPracticeBlock ? practiceCycle : 1,
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

  if (statusEl) {
    statusEl.textContent = "";
  }

  const practiceRowsOut = rows.filter((r) => r.is_practice === 1);
  if (hiddenJson) hiddenJson.value = JSON.stringify(practiceRowsOut);
  window.removeEventListener("keydown", onKeyDown);

  const form = document.querySelector("form");
  if (form) {
    form.submit();
    return;
  }

  show(nextBtn);
  setNextEnabled(true);
}

function finishRealTask() {
  hide(fixationEl);
  hide(choiceEl);
  hide(fasterEl);

  const mainRowsOut = rows.filter((r) => r.is_practice === 0);

  if (hiddenJson) {
    hiddenJson.value = JSON.stringify(mainRowsOut);
  }

  const form = document.querySelector("form");
  if (form) {
    form.submit();
    return;
  }

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
    statusEl.textContent = `Practice: Trial ${trialIndex + 1} / ${practiceTrialCount}`;
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

    const screenSuccess = setChoiceScreen(trials[trialIndex]);
    if (!screenSuccess) {
      console.warn(`[nextTrial] Failed to load trial ${trialIndex + 1}, skipping to next`);
      recordResponse({ chosen_item_id: null, is_timeout: true, advance: "normal" });
      return;
    }
    show(choiceEl);

    awaitingResponse = true;
    trialStartPerf = performance.now();

    startCountdown();
    if (!isPracticeBlock && timerEl) timerEl.textContent = "";

    timeoutHandle = setTimeout(() => {
      recordResponse({ chosen_item_id: null, is_timeout: true, advance: "faster" });
    }, EXPERIMENT.MAX_RESPONSE_WINDOW_MS);
  }, EXPERIMENT.FIXATION_MS);
}

hide(nextBtn);
setNextEnabled(false);
window.addEventListener("keydown", onKeyDown);
nextTrial();