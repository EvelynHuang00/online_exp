// my_experiment/static/my_experiment/js/wtp.js
import { SNACKS, BDM } from "./config.js";
import { downloadCSV } from "./export.js";

const subject_id = localStorage.getItem("subject_id") || "S001";
const session_id = localStorage.getItem("session_id") || "session_001";

// Expected WTP.html structure (inside block content):
// <div id="bdmPractice"></div>
// <div id="wtpMain" class="hidden">
//   <div id="wtpForm"></div>
//   <div id="bdmResult" style="margin-top:16px;"></div>
//   <button type="button" id="downloadWtpBtn" class="btn btn-primary">Download WTP CSV</button>
//   <button class="otree-btn-next btn btn-secondary" id="nextBtn" disabled>Next</button>
// </div>

const practiceEl = document.getElementById("bdmPractice");
const mainEl = document.getElementById("wtpMain");

const container = document.getElementById("wtpForm");
const downloadBtn = document.getElementById("downloadWtpBtn");
const resultEl = document.getElementById("bdmResult");

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
// -----------------------------------------------------

// -------------------- Main WTP table --------------------
function buildMainWTPTable() {
  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Snack</th>
          <th>Your bid</th>
        </tr>
      </thead>
      <tbody>
        ${SNACKS.map(
          (s) => `
          <tr>
            <td>${s.label}</td>
            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                class="form-control"
                id="bid_${s.id}"
                placeholder="0.00"
                required
              />
            </td>
          </tr>
        `
        ).join("")}
      </tbody>
    </table>
  `;
}

function setNextEnabled(enabled) {
  const nextBtn = document.getElementById("nextBtn");
  if (nextBtn) nextBtn.disabled = !enabled;
}

function validateAllBids() {
  // Only validate after the main table is shown
  // If mainEl is hidden, do not allow Next
  if (mainEl && mainEl.classList.contains("hidden")) return false;

  for (const s of SNACKS) {
    const el = document.getElementById(`bid_${s.id}`);
    if (!el) return false;
    const val = (el.value || "").trim();
    if (val === "") return false;
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) return false;
  }
  return true;
}

function attachBidValidationListeners() {
  for (const s of SNACKS) {
    const el = document.getElementById(`bid_${s.id}`);
    if (!el) continue;
    el.addEventListener("input", () => {
      setNextEnabled(validateAllBids());
    });
  }
  // initialize
  setNextEnabled(validateAllBids());
}

function collectBids() {
  const bids = [];
  for (const s of SNACKS) {
    const el = document.getElementById(`bid_${s.id}`);
    const val = (el?.value ?? "").trim();
    if (val === "") return { ok: false, msg: `Missing bid for: ${s.label}` };

    const bid = Number(val);
    if (!Number.isFinite(bid) || bid < 0) return { ok: false, msg: `Invalid bid for: ${s.label}` };

    bids.push({
      snack_id: s.id,
      snack_label: s.label,
      bid: Number(bid.toFixed(2)),
    });
  }
  return { ok: true, bids };
}
// ------------------------------------------------------

// -------------------- BDM practice --------------------
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
        <input type="number" min="0" step="0.01" class="form-control" id="practiceBid" placeholder="0.00" required>
      </div>

      <button type="button" class="btn btn-primary" id="practiceSubmit" style="margin-top:12px;">Submit</button>
      <div id="practiceResult" style="margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("practiceSubmit").addEventListener("click", () => {
    const val = (document.getElementById("practiceBid").value || "").trim();
    if (val === "") {
      alert("Enter a bid.");
      return;
    }

    const bid = Number(val);
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
    }, 2000);
  });
}

function showMain() {
  if (practiceEl) practiceEl.innerHTML = "";
  show(mainEl);
  buildMainWTPTable();
  attachBidValidationListeners();
}
// ------------------------------------------------------

// -------------------- Main WTP: download + enable Next --------------------
downloadBtn?.addEventListener("click", () => {
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

  downloadCSV(rows, `wtp_subject_${subject_id}.csv`);

});
// -----------------------------------------------------------------------

// Start: hide main, run practice first (if enabled)
hide(mainEl);

if (PRACTICE_N > 0) {
  renderPracticeTrial();
} else {
  showMain();
}