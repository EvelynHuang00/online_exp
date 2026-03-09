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

const leftBtn = $("leftBtn");
const rightBtn = $("rightBtn");
const leftImg = $("leftImg");
const rightImg = $("rightImg");
const leftLabel = $("leftLabel");
const rightLabel = $("rightLabel");
const timerEl = $("timer");
const downloadBtn = $("downloadBtn");

// -------------------- PRACTICE + MAIN TRIALS --------------------
const allTrials = buildTrials(); // 120 trials
const PRACTICE_N = Math.min(
  Number(EXPERIMENT.PRACTICE_BINARY_TRIALS ?? 5),
  allTrials.length
);

const practiceTrials = allTrials.slice(0, PRACTICE_N);
const mainTrials = allTrials.slice(PRACTICE_N);

// Start with practice block
let isPracticeBlock = PRACTICE_N > 0;
let trials = isPracticeBlock ? practiceTrials : mainTrials;
// ---------------------------------------------------------------

const rows = [];

let trialIndex = -1;
let awaitingResponse = false;
let trialStartPerf = null;
let timeoutHandle = null;
let countdownHandle = null;

function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
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
  // Do not show any countdown UI
  if (timerEl) timerEl.textContent = "";
  return;
}

function cleanupTrialTimers() {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (countdownHandle) clearInterval(countdownHandle);
  timeoutHandle = null;
  countdownHandle = null;
}

function showFasterThenContinue() {
  hide(choiceEl);
  hide(fixationEl);   // ensure cross is NOT visible during Faster
  if (timerEl) timerEl.textContent = "";

  show(fasterEl);

  setTimeout(() => {
    hide(fasterEl);

    // After Faster, show fixation (ITI) before moving on (optional but clean)
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
    timestamp: new Date().toISOString(),
  });

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

function nextTrial() {
  trialIndex += 1;

  // End of current block
  if (trialIndex >= trials.length) {
    // If we just finished practice, switch to main block
    if (isPracticeBlock) {
      isPracticeBlock = false;
      trials = mainTrials;
      trialIndex = -1;

      statusEl.textContent = "Practice complete. Main task starts now.";
      hide(fixationEl);
      hide(choiceEl);
      hide(fasterEl);
      if (timerEl) timerEl.textContent = "";

      setTimeout(nextTrial, 800);
      return;
    }

    // End of main block
    finishTask();
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

function finishTask() {
  hide(fixationEl);
  hide(choiceEl);
  hide(fasterEl);
  show(endEl);
  
  const mainRowsOut = rows.filter(r => r.is_practice === 0);
  document.getElementById("choiceDataJson").value = JSON.stringify(mainRowsOut);

  // Download ONLY main trials (exclude practice)
  downloadBtn.onclick = () => {
    const mainRowsOut = rows.filter((r) => r.is_practice === 0);
    downloadCSV(mainRowsOut, `choice_subject_${subject_id}.csv`);
  };

  window.removeEventListener("keydown", onKeyDown);
}


window.addEventListener("keydown", onKeyDown);
nextTrial();