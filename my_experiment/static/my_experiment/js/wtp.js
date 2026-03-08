// my_experiment/static/my_experiment/js/wtp.js
import { SNACKS, BDM } from "./config.js";
import { downloadCSV } from "./export.js";

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

// Expected WTP.html structure:
// <div id="bdmPractice"></div>
// <div id="wtpMain" class="hidden">
//   <div id="wtpForm"></div>
//   <div id="bdmResult"></div>
//   <input type="hidden" name="wtp_rows_json" id="wtp_rows_json">
//   <button type="button" id="downloadWtpBtn">Download WTP CSV</button>
//   <button class="otree-btn-next" id="nextBtn" disabled>Next</button>
// </div>

const practiceEl = document.getElementById("bdmPractice");
const mainEl = document.getElementById("wtpMain");

const container = document.getElementById("wtpForm");
const simulateBtn = document.getElementById("simulateBtn");
const resultEl = document.getElementById("bdmResult");

/* ADDED:
   This hidden input is used to send compact WTP data back to oTree backend.
   The goal is to support custom_export for the WTP dataset, while keeping the
   original participant-facing CSV download behavior unchanged. */
const hiddenWtpJson = document.getElementById("wtp_rows_json");

function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
}

// -------------------- BDM helpers --------------------
function pickBindingSnack() {
  return SNACKS[Math.floor(Math.random() * SNACKS.length)];
}

function drawPrice() {
  // Discrete grid draw: 0, step, 2*step, ..., ENDOWMENT
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


function randomOnGrid(min, max, step) {
  const nSteps = Math.round((max - min) / step);
  const k = Math.floor(Math.random() * (nSteps + 1));
  return Number((min + k * step).toFixed(2));
}

// Slider settings
function randomSliderValue() {
  const nSteps = Math.round((SLIDER_MAX - SLIDER_MIN) / SLIDER_STEP);
  const k = Math.floor(Math.random() * (nSteps + 1));
  return Number((SLIDER_MIN + k * SLIDER_STEP).toFixed(2));
}

const SLIDER_MIN = 0;
const SLIDER_MAX = 1.0;
const SLIDER_STEP = 0.05;

// -------------------- Main WTP table (sliders) --------------------
function buildMainWTPTable() {
  const slidersHere = document.getElementById("sliders_here");
  if (!slidersHere) return;

  slidersHere.innerHTML = "";

  const min = 0;
  const max = 1.0;
  const step = 0.05;

  for (const s of SNACKS) {
    // Create a wrapper for each snack+slider so they stay together
    const block = document.createElement("div");
    block.style.margin = "18px 0";

    // Snack label (above the slider)
    const label = document.createElement("div");
    label.style.fontWeight = "600";
    label.style.marginBottom = "6px";
    label.textContent = s.label;

    // Slider container
    const sliderDiv = document.createElement("div");

    block.appendChild(label);
    block.appendChild(sliderDiv);
    slidersHere.appendChild(block);

    const fieldName = `bid_${s.id}`;
    const slider = new mgslider(fieldName, min, max, step);
    slider.recall = true;

    // Print slider INSIDE this snack's container
    slider.print(sliderDiv);
  }
}

// -------------------- Next gating --------------------
function setNextEnabled(enabled) {
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = !enabled;
}

function validateAllBids() {
  if (mainEl && mainEl.classList.contains("hidden")) return false;

  for (const s of SNACKS) {
    const el = document.getElementById(`bid_${s.id}`);
    if (!el) return false;
    const num = Number(el.value);
    if (!Number.isFinite(num) || num < 0) return false;
  }
  return true;
}

// -------------------- Collect bids (sliders) --------------------
function collectBids() {
  const bids = [];

  for (const s of SNACKS) {
    const fieldName = `bid_${s.id}`;
    const input = document.querySelector(`input[name="${fieldName}"]`);
    if (!input) return { ok: false, msg: `Missing slider input for: ${s.label}` };

    const bid = Number(input.value);
    if (!Number.isFinite(bid) || bid < 0) return { ok: false, msg: `Invalid bid for: ${s.label}` };

    bids.push({
      snack_id: s.id,
      snack_label: s.label,
      bid: Number(bid.toFixed(2)),
    });
  }

  return { ok: true, bids };
}

// -------------------- BDM practice (sliders) --------------------
const PRACTICE_N = Number(BDM.PRACTICE_TRIALS ?? 3);
let practiceCount = 0;

function renderPracticeTrial() {
  if (!practiceEl || PRACTICE_N <= 0) {
    showMain();
    return;
  }

  const snack = SNACKS[Math.floor(Math.random() * SNACKS.length)];

  practiceEl.innerHTML = `
    <div class="container">
      <h4>BDM Practice (${practiceCount + 1} / ${PRACTICE_N})</h4>
      <p>Snack: <strong>${snack.label}</strong></p>

      <div class="form-group">
        <label>Your bid</label>
        <div style="display:flex; gap:12px; align-items:center;">
          <input
            type="range"
            min="${SLIDER_MIN}"
            max="${SLIDER_MAX}"
            step="${SLIDER_STEP}"
            value="0"
            class="form-range"
            id="practiceBid"
          />
          <span id="practiceBidVal" style="min-width:72px; text-align:right;">$0.00</span>
        </div>
      </div>

      <button type="button" class="btn btn-primary" id="practiceSubmit" style="margin-top:12px;">Submit</button>
      <div id="practiceResult" style="margin-top:12px;"></div>
    </div>
  `;

  const practiceSlider = document.getElementById("practiceBid");
  const practiceLabel = document.getElementById("practiceBidVal");

  const updatePractice = () => {
    const v = Number(practiceSlider.value);
    practiceLabel.textContent = `$${v.toFixed(2)}`;
  };

  practiceSlider.addEventListener("input", updatePractice);
  updatePractice();

  document.getElementById("practiceSubmit").addEventListener("click", () => {
    const bid = Number(practiceSlider.value);
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
        showMain();
      } else {
        renderPracticeTrial();
      }
    }, 4000);
  });
}

function showMain() {
  if (practiceEl) practiceEl.innerHTML = "";
  show(mainEl);
  buildMainWTPTable();
  setNextEnabled(validateAllBids());
}

// -------------------- Main WTP: download --------------------
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

  /* ADDED:
     Build a compact backend payload for custom_export.
     This does NOT change the existing local CSV download format.
     It only adds a JSON copy that oTree can store in Player.wtp_rows_json.

     Target exported columns:
     session_id, subject_id, snack_id, bid_value, price_draw

     We keep price_draw only for the binding snack, and leave it blank for the
     non-binding snacks. */
  const backendRows = out.bids.map((r) => {
    const isBinding = r.snack_id === binding.id;
    return {
      snack_id: r.snack_id,
      bid_value: r.bid,
      price_draw: isBinding ? Number(price_draw.toFixed(2)) : "",
    };
  });

  /* ADDED:
     Write the backend payload into the hidden input so the page submission
     can send WTP data to the backend. This is the only required frontend
     change for enabling the WTP custom export. */
  if (hiddenWtpJson) {
    hiddenWtpJson.value = JSON.stringify(backendRows);
  }

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
    document.getElementById("wtpDataJson").value = JSON.stringify(rows);

    const nextBtn = document.getElementById("nextBtn");
    if (nextBtn) nextBtn.disabled = false;
  }

});

// -------------------- Start --------------------
hide(mainEl);
setNextEnabled(false);

if (PRACTICE_N > 0) {
  renderPracticeTrial();
} else {
  showMain();
}