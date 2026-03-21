// my_experiment/static/my_experiment/js/wtp.js
import { SNACKS, PRACTICE_SNACKS, BDM } from "./config.js";
import { downloadCSV } from "./export.js";

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

const headerEl = document.getElementById("wtpHeader");
const practiceEl = document.getElementById("bdmPractice");
const mainEl = document.getElementById("wtpMain");

const simulateBtn = document.getElementById("simulateBtn");
const resultEl = document.getElementById("bdmResult");
const nextBtn = document.getElementById("nextBtn");
const hiddenJson = document.getElementById("wtpDataJson");
const alertOverlay = document.getElementById("wtpAlert");
const alertCloseBtn = document.getElementById("wtpAlertClose");
const alertMessageEl = document.getElementById("wtpAlertMessage");

function resolvePhase() {
  let src = null;
  const root = document.getElementById("wtpApp");
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
  const root = document.getElementById("wtpApp");
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

const formatMoney = (value) => `$${Number(value).toFixed(2)}`;

const sliderState = new Map();
const MISSING_BID_MESSAGE = "You still need to place a bid for every snack before submitting.";
const HIGHLIGHT_DURATION_MS = 1200;

function registerSliderField(fieldName, block) {
  sliderState.set(fieldName, { touched: false, block });
}

function markSliderTouched(fieldName) {
  const entry = sliderState.get(fieldName);
  if (entry) {
    entry.touched = true;
  }
}

function clearSliderEntriesByPrefix(prefix) {
  for (const key of Array.from(sliderState.keys())) {
    if (key.startsWith(`${prefix}_`)) {
      sliderState.delete(key);
    }
  }
}

function findUntouchedSnacks(snacks, fieldPrefix) {
  const missing = [];
  for (const snack of snacks) {
    const key = `${fieldPrefix}_${snack.id}`;
    const meta = sliderState.get(key);
    if (!meta || !meta.touched) {
      missing.push({ key, block: meta?.block ?? null });
    }
  }
  return missing;
}

function highlightMissingSnacks(entries) {
  if (!entries.length) return;

  let firstBlock = null;
  for (const entry of entries) {
    const block = entry.block;
    if (!block) {
      continue;
    }

    if (!firstBlock) {
      firstBlock = block;
    }

    block.classList.remove("wtp-snack-missing");
    void block.offsetWidth;
    block.classList.add("wtp-snack-missing");
    setTimeout(() => block.classList.remove("wtp-snack-missing"), HIGHLIGHT_DURATION_MS);
  }

  if (firstBlock) {
    firstBlock.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function requireAllSnacksTouched(snacks, fieldPrefix) {
  const missing = findUntouchedSnacks(snacks, fieldPrefix);
  if (!missing.length) {
    return true;
  }

  highlightMissingSnacks(missing);
  showMissingBidAlert(MISSING_BID_MESSAGE);
  return false;
}

function showMissingBidAlert(message) {
  if (alertMessageEl) {
    alertMessageEl.textContent = message;
  }
  if (alertOverlay) {
    alertOverlay.classList.add("visible");
  }
}

function hideMissingBidAlert() {
  if (alertOverlay) {
    alertOverlay.classList.remove("visible");
  }
}

alertCloseBtn?.addEventListener("click", hideMissingBidAlert);
alertOverlay?.addEventListener("click", (event) => {
  if (event.target === alertOverlay) {
    hideMissingBidAlert();
  }
});

let practiceSubmitted = false;
let realSubmitted = false;

function show(el) {
  if (el) el.style.display = "";
}

function hide(el) {
  if (el) el.style.display = "none";
}

function setNextEnabled(enabled) {
  if (nextBtn) nextBtn.disabled = !enabled;
}

function renderOutcomeBlock(targetEl, { heading, snackLabel, price, bid, purchase, payment, remaining, endowment }) {
  if (!targetEl) return;

  const priceText = formatMoney(price);
  const bidText = formatMoney(bid);
  const paymentText = formatMoney(payment);
  const remainingText = formatMoney(remaining);
  const endowmentText = formatMoney(endowment);

  const verdict = purchase
    ? `You successfully purchase ${snackLabel} for ${priceText} because your bid of ${bidText} was higher than the price (${priceText}).`
    : `You do not purchase ${snackLabel} because your bid of ${bidText} was lower than the price (${priceText}).`;

  targetEl.innerHTML = `
    <div class="bdm-outcome">
      <h4>${heading}</h4>
      <p>${verdict}</p>
    </div>
  `;
}

// -------------------- BDM helpers --------------------
function pickBindingSnack(snacks) {
  return snacks[Math.floor(Math.random() * snacks.length)];
}

function drawPrice() {
  const endowment = Number(BDM.ENDOWMENT);
  const step = Number(BDM.PRICE_STEP);

  if (!Number.isFinite(endowment) || endowment <= 0) {
    throw new Error("BDM.ENDOWMENT must be a positive number");
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("BDM.PRICE_STEP must be a positive number");
  }

  const nSteps = Math.round(endowment / step);
  const k = Math.floor(Math.random() * (nSteps + 1));
  return Number((k * step).toFixed(2));
}

const SLIDER_MIN = 0;
const SLIDER_MAX = 1.0;
const SLIDER_STEP = 0.05;

// -------------------- general render function --------------------

function renderSnackSlider({ container, snack, fieldName }) {
  const block = document.createElement("div");
  block.style.margin = "24px 0";
  block.style.padding = "16px";
  block.style.border = "1px solid #ddd";
  block.style.borderRadius = "10px";
  block.style.textAlign = "center";
  block.classList.add("wtp-snack-card");

  const img = document.createElement("img");
  img.src = snack.img;
  img.alt = snack.label;
  img.style.maxWidth = "160px";
  img.style.maxHeight = "160px";
  img.style.objectFit = "contain";
  img.style.display = "block";
  img.style.margin = "0 auto 12px auto";

  const nameText = document.createElement("div");
  nameText.textContent = snack.label;
  nameText.style.fontWeight = "600";
  nameText.style.margin = "8px 0 12px 0";

  const sliderRow = document.createElement("div");
  sliderRow.style.display = "flex";
  sliderRow.style.alignItems = "center";
  sliderRow.style.justifyContent = "center";
  sliderRow.style.width = "100%";

  const sliderDiv = document.createElement("div");
  sliderDiv.style.width = "100%";
  sliderDiv.style.maxWidth = "700px";
  sliderDiv.style.margin = "0 auto";

  sliderRow.appendChild(sliderDiv);

  block.appendChild(img);
  block.appendChild(nameText);
  block.appendChild(sliderRow);
  container.appendChild(block);

  registerSliderField(fieldName, block);
  const slider = new mgslider(fieldName, SLIDER_MIN, SLIDER_MAX, SLIDER_STEP);
  slider.hook = () => markSliderTouched(fieldName);
  slider.recall = false;
  slider.print(sliderDiv);

  return {
    block,
    sliderDiv,
    getValue: () => {
      const input = document.querySelector(`input[name="${fieldName}"]`);
      return input ? Number(input.value || 0) : 0;
    },
  };
}

// -------------------- Main WTP table --------------------
function buildWTPTable(slidersContainerId, snacks, fieldPrefix = "bid") {
  const slidersHere = document.getElementById(slidersContainerId);
  if (!slidersHere) return;

  clearSliderEntriesByPrefix(fieldPrefix);
  slidersHere.innerHTML = "";

  for (const s of snacks) {
    renderSnackSlider({
      container: slidersHere,
      snack: s,
      fieldName: `${fieldPrefix}_${s.id}`,
    });
  }
}

function collectBids(snacks, fieldPrefix = "bid") {
  const bids = [];

  for (const s of snacks) {
    const fieldName = `${fieldPrefix}_${s.id}`;
    const input = document.querySelector(`input[name="${fieldName}"]`);
    if (!input) {
      return { ok: false, msg: `Missing slider input for: ${s.label}` };
    }

    const bid = Number(input.value);
    if (!Number.isFinite(bid) || bid < 0) {
      return { ok: false, msg: `Invalid bid for: ${s.label}` };
    }

    bids.push({
      snack_id: s.id,
      snack_label: s.label,
      bid: Number(bid.toFixed(2)),
    });
  }

  return { ok: true, bids };
}

// -------------------- Practice BDM only --------------------
function buildPracticeWTPPage() {
  if (!practiceEl) return;

  hide(headerEl);
  hide(mainEl);
  hide(nextBtn);
  setNextEnabled(false);

  practiceEl.innerHTML = `
  <div class="instruction-shell">
    <div class="instruction-card" style="max-width: 900px; margin: 0 auto; padding: 32px 36px;">
      
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="margin-bottom: 12px;">Practice</h2>
        <p style="margin: 0 0 8px 0; font-size: 17px; line-height: 1.6;">
          For each snack, choose the highest price you would be willing to pay.
        </p>
        <p style="margin: 0; font-size: 17px; line-height: 1.6;">
          You can drag the slider or click on the bar to set your price.
        </p>
      </div>

      <div id="practice_sliders_here" style="margin-top: 8px;"></div>

      <div id="practiceResult" style="margin-top: 20px;"></div>

      <div style="margin-top: 24px; text-align: center;">
        <button type="button" class="btn btn-primary" id="practiceSimulateBtn" style="min-width: 160px;">
          Submit Bids
        </button>
      </div>
    </div>
  </div>
`;

  buildWTPTable("practice_sliders_here", PRACTICE_SNACKS, "practice_bid");

  const practiceSimulateBtn = document.getElementById("practiceSimulateBtn");
  const practiceResultEl = document.getElementById("practiceResult");

  practiceSimulateBtn?.addEventListener("click", () => {
    if (practiceSubmitted) return;

    if (!requireAllSnacksTouched(PRACTICE_SNACKS, "practice_bid")) {
      return;
    }

    const out = collectBids(PRACTICE_SNACKS, "practice_bid");
    if (!out.ok) {
      alert(out.msg);
      return;
    }

    const endowment = Number(BDM.ENDOWMENT);
    const binding = pickBindingSnack(PRACTICE_SNACKS);
    const price_draw = drawPrice();

    const bidMap = new Map(out.bids.map((r) => [r.snack_id, r.bid]));
    const bindingBid = Number(bidMap.get(binding.id) ?? 0);

    const purchase = bindingBid >= price_draw;
    const payment = purchase ? price_draw : 0;
    const remaining = Number((endowment - payment).toFixed(2));
    const timestamp = new Date().toISOString();

    const rows = out.bids.map((r) => {
      const isBinding = r.snack_id === binding.id;
      return {
        subject_id,
        session_id,
        snack_id: r.snack_id,
        snack_label: r.snack_label,
        bid: r.bid.toFixed(2),
        endowment_initial: endowment.toFixed(2),
        binding_snack_id: binding.id,
        is_binding: isBinding ? 1 : 0,
        price_draw: isBinding ? price_draw.toFixed(2) : "",
        purchase_decision: isBinding ? (purchase ? 1 : 0) : "",
        payment: isBinding ? payment.toFixed(2) : "",
        remaining_cash: isBinding ? remaining.toFixed(2) : "",
        timestamp,
        is_practice: 1,
        practice_cycle: practiceCycle,
      };
    });

    renderOutcomeBlock(practiceResultEl, {
      heading: "Practice Bidding outcome",
      snackLabel: binding.label,
      price: price_draw,
      bid: bindingBid,
      purchase,
      payment,
      remaining,
      endowment,
    });

    if (hiddenJson) hiddenJson.value = JSON.stringify(rows);
    show(nextBtn);
    setNextEnabled(true);

    practiceSubmitted = true;
    practiceSimulateBtn.disabled = true;
    practiceSimulateBtn.textContent = "Bids Submitted";
  });
}

// -------------------- Real WTP only --------------------
function showRealMain() {
  if (practiceEl) practiceEl.innerHTML = "";
  show(headerEl);
  show(mainEl);
  hide(nextBtn);
  buildWTPTable("sliders_here", SNACKS, "bid");
  if (hiddenJson) hiddenJson.value = "";
  setNextEnabled(false);
}

simulateBtn?.addEventListener("click", () => {
  if (realSubmitted) return;

  if (!requireAllSnacksTouched(SNACKS, "bid")) {
    return;
  }

  const out = collectBids(SNACKS, "bid");
  if (!out.ok) {
    alert(out.msg);
    return;
  }

  const endowment = Number(BDM.ENDOWMENT);
  const binding = pickBindingSnack(SNACKS);
  const price_draw = drawPrice();

  const bidMap = new Map(out.bids.map((r) => [r.snack_id, r.bid]));
  const bindingBid = Number(bidMap.get(binding.id) ?? 0);

  const purchase = bindingBid >= price_draw;
  const payment = purchase ? price_draw : 0;
  const remaining = Number((endowment - payment).toFixed(2));
  const timestamp = new Date().toISOString();

  const rows = out.bids.map((r) => {
    const isBinding = r.snack_id === binding.id;
    return {
      subject_id,
      session_id,
      snack_id: r.snack_id,
      snack_label: r.snack_label,
      bid: r.bid.toFixed(2),

      endowment_initial: endowment.toFixed(2),
      binding_snack_id: binding.id,
      is_binding: isBinding ? 1 : 0,
      price_draw: isBinding ? price_draw.toFixed(2) : "",
      purchase_decision: isBinding ? (purchase ? 1 : 0) : "",
      payment: isBinding ? payment.toFixed(2) : "",
      remaining_cash: isBinding ? remaining.toFixed(2) : "",
      timestamp,
      practice_cycle: 1,
    };
  });

  renderOutcomeBlock(resultEl, {
    heading: "BDM outcome",
    snackLabel: binding.label,
    price: price_draw,
    bid: bindingBid,
    purchase,
    payment,
    remaining,
    endowment,
  });

  if (hiddenJson) hiddenJson.value = JSON.stringify(rows);
  show(nextBtn);
  setNextEnabled(true);

  realSubmitted = true;
  simulateBtn.disabled = true;
  simulateBtn.textContent = "Bids Submitted";
});

// -------------------- Start --------------------
hide(headerEl);
hide(mainEl);
hide(nextBtn);
setNextEnabled(false);

if (isReal) {
  showRealMain();
} else {
  buildPracticeWTPPage();
}