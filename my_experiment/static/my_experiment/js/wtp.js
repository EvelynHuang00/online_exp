// my_experiment/static/my_experiment/js/wtp.js
import { SNACKS, BDM } from "./config.js";
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

const phase = localStorage.getItem("phase") || "practice";
const isReal = phase === "real";

function show(el) {
  if (el) el.style.display = "";
}

function hide(el) {
  if (el) el.style.display = "none";
}

function setNextEnabled(enabled) {
  if (nextBtn) nextBtn.disabled = !enabled;
}

// -------------------- BDM helpers --------------------
function pickBindingSnack() {
  return SNACKS[Math.floor(Math.random() * SNACKS.length)];
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

  const img = document.createElement("img");
  img.src = snack.img;
  img.alt = snack.label;
  img.style.maxWidth = "160px";
  img.style.maxHeight = "160px";
  img.style.objectFit = "contain";
  img.style.display = "block";
  img.style.margin = "0 auto 12px auto";

  const sliderRow = document.createElement("div");
  sliderRow.style.display = "flex";
  sliderRow.style.alignItems = "center";
  sliderRow.style.justifyContent = "center";
  sliderRow.style.gap = "12px";
  sliderRow.style.width = "100%";

  const sliderDiv = document.createElement("div");
  sliderDiv.style.width = "100%";
  sliderDiv.style.maxWidth = "700px";
  sliderDiv.style.margin = "0 auto";

  sliderRow.appendChild(sliderDiv);

  block.appendChild(img);
  block.appendChild(sliderRow);
  container.appendChild(block);

  const slider = new mgslider(fieldName, SLIDER_MIN, SLIDER_MAX, SLIDER_STEP);
  slider.recall = false;
  slider.print(sliderDiv);

  return {
    block,
    sliderDiv,
    getValue: () => {
      const input = document.getElementById(fieldName);
      return input ? Number(input.value || 0) : 0;
    },
  };
}

// -------------------- Main WTP table --------------------
function buildMainWTPTable() {
  const slidersHere = document.getElementById("sliders_here");
  if (!slidersHere) return;

  slidersHere.innerHTML = "";

  for (const s of SNACKS) {
    renderSnackSlider({
      container: slidersHere,
      snack: s,
      fieldName: `bid_${s.id}`,
    });
  }
}

function collectBids() {
  const bids = [];

  for (const s of SNACKS) {
    const fieldName = `bid_${s.id}`;
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
const PRACTICE_N = Number(BDM.PRACTICE_TRIALS ?? 3);
let practiceCount = 0;

function finishPracticeOnly() {
  if (!practiceEl) return;

  hide(headerEl);
  hide(mainEl);

  practiceEl.innerHTML = `
    <div class="container">
      <h4>BDM practice complete</h4>
      <p>You have completed the BDM practice trial(s).</p>
      <p>Click <strong>Next</strong> to continue to the Binary Choice instructions.</p>
    </div>
  `;

  if (hiddenJson) hiddenJson.value = "";
  show(nextBtn);
  setNextEnabled(true);
}

function renderPracticeTrial() {
  if (!practiceEl || PRACTICE_N <= 0) {
    finishPracticeOnly();
    return;
  }

  hide(headerEl);
  hide(mainEl);
  hide(nextBtn);

  const snack = SNACKS[Math.floor(Math.random() * SNACKS.length)];

  practiceEl.innerHTML = `
    <div class="container" style="text-align:center;">
      <h4>BDM Practice (${practiceCount + 1} / ${PRACTICE_N})</h4>
      <div id="practiceSliderContainer"></div>
      <button type="button" class="btn btn-primary" id="practiceSubmit" style="margin-top:12px;">Submit</button>
      <div id="practiceResult" style="margin-top:12px;"></div>
    </div>
  `;

  const practiceSliderContainer = document.getElementById("practiceSliderContainer");

  const rendered = renderSnackSlider({
    container: practiceSliderContainer,
    snack,
    fieldName: "practiceBid",
  });

  document.getElementById("practiceSubmit").addEventListener("click", () => {
    const bid = rendered.getValue();

    if (!Number.isFinite(bid) || bid < 0) {
      alert("Invalid bid.");
      return;
    }

    const endowment = Number(BDM.ENDOWMENT);
    const price = drawPrice();
    const purchase = bid >= price;
    const payment = purchase ? price : 0;
    const remaining = Number((endowment - payment).toFixed(2));

    document.getElementById("practiceResult").innerHTML = `
      <div class="alert alert-info">
        <div>Random price: $${price.toFixed(2)}</div>
        <div>Your bid: $${bid.toFixed(2)}</div>
        <div>Decision: ${purchase ? "Purchased" : "Not purchased"}</div>
        <div>Payment: $${payment.toFixed(2)}</div>
        <div>Remaining cash: $${remaining.toFixed(2)}</div>
      </div>
    `;

    practiceCount += 1;

    setTimeout(() => {
      if (practiceCount >= PRACTICE_N) {
        finishPracticeOnly();
      } else {
        renderPracticeTrial();
      }
    }, 2000);
  });
}

// -------------------- Real WTP only --------------------
function showRealMain() {
  if (practiceEl) practiceEl.innerHTML = "";
  show(headerEl);
  show(mainEl);
  hide(nextBtn);
  buildMainWTPTable();
  if (hiddenJson) hiddenJson.value = "";
  setNextEnabled(false);
}

simulateBtn?.addEventListener("click", () => {
  const out = collectBids();
  if (!out.ok) {
    alert(out.msg);
    return;
  }

  const endowment = Number(BDM.ENDOWMENT);
  const binding = pickBindingSnack();
  const price_draw = drawPrice();

  const bidMap = new Map(out.bids.map((r) => [r.snack_id, r.bid]));
  const bindingBid = bidMap.get(binding.id);

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
    };
  });

  if (resultEl) {
    resultEl.innerHTML = `
      <div class="alert alert-info">
        <div><strong>BDM outcome</strong></div>
        <div>Binding snack: ${binding.label}</div>
        <div>Random price: $${price_draw.toFixed(2)}</div>
        <div>Your bid: $${bindingBid.toFixed(2)}</div>
        <div>Decision: ${purchase ? "Purchased" : "Not purchased"}</div>
        <div>Payment: $${payment.toFixed(2)}</div>
        <div>Remaining cash: $${remaining.toFixed(2)}</div>
      </div>
    `;
  }

  if (hiddenJson) hiddenJson.value = JSON.stringify(rows);
  show(nextBtn);
  setNextEnabled(true);
});

// -------------------- Start --------------------
hide(headerEl);
hide(mainEl);
hide(nextBtn);
setNextEnabled(false);

if (isReal) {
  showRealMain();
} else {
  renderPracticeTrial();
}