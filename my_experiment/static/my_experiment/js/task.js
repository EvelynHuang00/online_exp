// my_experiment/static/my_experiment/js/task.js
import { EXPERIMENT, SNACKS } from "./config.js";
import { buildTrials } from "./trialgen.js";
import { downloadCSV } from "./export.js";

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

const $ = (id) => document.getElementById(id);

const snackById = new Map(SNACKS.map((s) => [s.id, s]));

const statusEl = $("status");
const fixationEl = $("fixation");
const choiceEl = $("choice");
const endEl = $("end");

const leftBtn = $("leftBtn");
const rightBtn = $("rightBtn");
const leftImg = $("leftImg");
const rightImg = $("rightImg");
const leftLabel = $("leftLabel");
const rightLabel = $("rightLabel");
const timerEl = $("timer");
const downloadBtn = $("downloadBtn");

// -------------------- PRACTICE + MAIN TRIALS --------------------
const allTrials = buildTrials(); // your existing 120 trials generator
const PRACTICE_N = Number(EXPERIMENT.PRACTICE_BINARY_TRIALS ?? 5);

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
  el.classList.remove("hidden");
}
function hide(el) {
  el.classList.add("hidden");
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
  const start = performance.now();
  const total = EXPERIMENT.MAX_RESPONSE_WINDOW_MS;

  countdownHandle = setInterval(() => {
    const elapsed = performance.now() - start;
    const remaining = Math.max(0, total - elapsed);
    timerEl.textContent = `Time left: ${(remaining / 1000).toFixed(1)}s`;
    if (remaining <= 0) clearInterval(countdownHandle);
  }, 100);
}

function cleanupTrialTimers() {
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (countdownHandle) clearInterval(countdownHandle);
  timeoutHandle = null;
  countdownHandle = null;
}

function recordResponse({ chosen_item_id, is_timeout }) {
  if (!awaitingResponse) return;

  awaitingResponse = false;
  cleanupTrialTimers();

  const tEnd = performance.now();
  const rt_ms = is_timeout ? "" : Math.round(tEnd - trialStartPerf);

  const trial = trials[trialIndex];

  rows.push({
    subject_id,
    session_id,
    // "trial_index" here is within-block; keep it as-is for readability
    trial_index: trialIndex + 1,

    // add practice flag so you can filter later
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
  setTimeout(nextTrial, EXPERIMENT.ITI_MS);
}

function onKeyDown(e) {
  if (!awaitingResponse) return;
  if (e.key === EXPERIMENT.KEY_LEFT)
    recordResponse({
      chosen_item_id: trials[trialIndex].left_item_id,
      is_timeout: false,
    });
  if (e.key === EXPERIMENT.KEY_RIGHT)
    recordResponse({
      chosen_item_id: trials[trialIndex].right_item_id,
      is_timeout: false,
    });
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

      // brief message before main starts
      statusEl.textContent = "Practice complete. Main task starts now.";
      hide(fixationEl);
      hide(choiceEl);

      setTimeout(nextTrial, 800);
      return;
    }

    // End of main block
    finishTask();
    return;
  }

  const blockLabel = isPracticeBlock ? "Practice" : "Main";
  statusEl.textContent = `${blockLabel}: Trial ${trialIndex + 1} / ${trials.length}`;

  show(fixationEl);
  hide(choiceEl);

  setTimeout(() => {
    hide(fixationEl);

    setChoiceScreen(trials[trialIndex]);
    show(choiceEl);

    awaitingResponse = true;
    trialStartPerf = performance.now();

    startCountdown();

    timeoutHandle = setTimeout(() => {
      recordResponse({ chosen_item_id: null, is_timeout: true });
    }, EXPERIMENT.MAX_RESPONSE_WINDOW_MS);
  }, EXPERIMENT.FIXATION_MS);
}

function finishTask() {
  hide(fixationEl);
  hide(choiceEl);
  show(endEl);

  // Download ONLY main trials (exclude practice)
  downloadBtn.onclick = () => {
    const mainRowsOut = rows.filter((r) => r.is_practice === 0);
    downloadCSV(mainRowsOut, `choice_subject_${subject_id}.csv`);
  };

  window.removeEventListener("keydown", onKeyDown);
}

leftBtn.onclick = () => {
  if (!awaitingResponse) return;
  recordResponse({
    chosen_item_id: trials[trialIndex].left_item_id,
    is_timeout: false,
  });
};
rightBtn.onclick = () => {
  if (!awaitingResponse) return;
  recordResponse({
    chosen_item_id: trials[trialIndex].right_item_id,
    is_timeout: false,
  });
};

window.addEventListener("keydown", onKeyDown);
nextTrial();