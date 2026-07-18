// FOS — Personal Financial Operating System (Ledger-Based Cloud Refactor)

// ==========================================
// 1. SUPABASE CLOUD SETUP (Option 1)
// Replace these placeholders with your unique credentials from Supabase Settings when ready!
// ==========================================
const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";

let supabaseClient = null;
if (
  SUPABASE_URL !== "YOUR_SUPABASE_URL_HERE" &&
  SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY_HERE" &&
  window.supabase?.createClient
) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ==========================================
// 2. CORE APP STATE AND STORAGE FUNCTIONS
// ==========================================
let state = {
  accounts: { 
    main: 0.00, 
    bills: 0.00, 
    tax: 0.00, 
    emergency: 0.00, 
    gold: 0.00 
  },
  policy: {
    mode: "Stability",
    taxRate: 15,
    emergencyTarget: 10000,
    goldTarget: 5000,
    exchangeRate: 32.5,
    stabilityEmergencyPct: 50,
    growthEmergencyPct: 20,
    wealthEmergencyPct: 10,
    nextPayday: ""
  },
  incomes: [],
  bills: [],
  transfers: [],
  activeMission: null
};

function round2(num) {
  const value = Number(num);
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Safe Loading (Supports LocalStorage fallback or Supabase sync)
async function loadState() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('app_state')
        .select('data')
        .eq('id', 'user_fos_state')
        .single();

      if (data && data.data) {
        state = data.data;
        cleanStateLegacyKeys();
        renderAll();
        return;
      }
    } catch (e) {
      console.warn("Supabase load failed. Falling back to LocalStorage.", e);
    }
  }

  // Local fallback
  const saved = localStorage.getItem("fos_state");
  if (saved) {
    state = JSON.parse(saved);
    cleanStateLegacyKeys();
  } else {
    saveState();
  }
}

function cleanStateLegacyKeys() {
  if (state.policy.goldPct !== undefined) delete state.policy.goldPct;
  if (state.policy.lifestyleAllowance !== undefined) delete state.policy.lifestyleAllowance;
}

// Sync changes to Cloud & Local Storage
async function saveState() {
  localStorage.setItem("fos_state", JSON.stringify(state));

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('app_state')
        .upsert({ id: 'user_fos_state', data: state, updated_at: new Date() });
    } catch (e) {
      console.error("Failed to sync to Supabase:", e);
    }
  }

  renderAll();
}

// ==========================================
// 3. LEDGER OPERATIONS
// ==========================================
function executeTransfer(from, to, amount, memo, metadata = {}) {
  const amt = round2(amount);
  
  if (metadata.type !== "RECONCILIATION" && amt <= 0) {
    return false;
  }

  if (from !== "EXTERNAL" && from !== "SYSTEM" && metadata.type !== "RECONCILIATION" && amt > 0) {
    const sourceKey = from.toLowerCase();
    if (!(sourceKey in state.accounts) || state.accounts[sourceKey] < amt) {
      return false;
    }
  }

  if (metadata.type === "RECONCILIATION") {
    state.accounts.main = round2(state.accounts.main + amt);
  } else {
    if (from !== "EXTERNAL") {
      const key = from.toLowerCase();
      state.accounts[key] = round2(state.accounts[key] - amt);
    }
    if (to !== "EXTERNAL") {
      const key = to.toLowerCase();
      state.accounts[key] = round2(state.accounts[key] + amt);
    }
  }

  state.transfers.unshift({
    id: Date.now() + Math.random().toString(36).substr(2, 5),
    date: new Date().toISOString().split("T")[0],
    from: metadata.type === "RECONCILIATION" ? "SYSTEM" : from,
    to: metadata.type === "RECONCILIATION" ? "Main" : to,
    amount: Math.abs(amt),
    type: metadata.type || (amt < 0 ? "DEBIT" : "CREDIT"),
    memo,
    incomeId: metadata.incomeId || null,
    recommendedAmount: metadata.recommendedAmount !== undefined ? round2(metadata.recommendedAmount) : null,
    actualAmount: Math.abs(amt)
  });

  saveState();
  return true;
}

// ==========================================
// 4. SCREEN NAVIGATION & INTERACTIVITY
// ==========================================
const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll(".bottom-nav button");

navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const targetScreen = btn.getAttribute("data-screen");
    screens.forEach(s => s.classList.remove("active"));
    navButtons.forEach(b => b.classList.remove("active"));
    document.getElementById(targetScreen).classList.add("active");
    btn.classList.add("active");
  });
});

function navigateTo(screenId) {
  const btn = document.querySelector(`[data-screen="${screenId}"]`);
  if (btn) {
    btn.click();
  } else {
    screens.forEach(s => s.classList.remove("active"));
    navButtons.forEach(b => b.classList.remove("active"));
    
    const target = document.getElementById(screenId);
    if (target) target.classList.add("active");
    if (navButtons[0]) navButtons[0].classList.add("active");
  }
}

// Failsafe Global Click Listener for dynamically loaded elements
document.addEventListener("click", (event) => {
  if (event.target && event.target.id === "backHomeBtn") {
    navigateTo("homeScreen");
  }
});

// ==========================================
// 5. BILL CALCULATOR & SCHEDULER (UPDATED FOR FORTNIGHTLY CYCLES)
// ==========================================
function getBillAmountInAUD(bill) {
  const amt = parseFloat(bill.amount);
  if (bill.currency === "EGP") {
    return round2(amt / parseFloat(state.policy.exchangeRate));
  }
  return round2(amt);
}

function evaluateRecurringBillCycles() {
  const now = new Date();
  let stateChanged = false;

  state.bills.forEach(bill => {
    if (bill.status === "Paid" && bill.lastPaidDate) {
      const lastPaid = new Date(bill.lastPaidDate);
      let cycleResetNeeded = false;

      if (bill.recurring === "Monthly") {
        if (now.getMonth() !== lastPaid.getMonth() || now.getFullYear() !== lastPaid.getFullYear()) {
          cycleResetNeeded = true;
        }
      } else if (bill.recurring === "Weekly") {
        const diffDays = Math.ceil(Math.abs(now - lastPaid) / (1000 * 60 * 60 * 24));
        if (diffDays >= 7) cycleResetNeeded = true;
      } else if (bill.recurring === "Fortnightly") {
        const diffDays = Math.ceil(Math.abs(now - lastPaid) / (1000 * 60 * 60 * 24));
        if (diffDays >= 14) cycleResetNeeded = true;
      } else if (bill.recurring === "Yearly") {
        if (now.getFullYear() !== lastPaid.getFullYear()) {
          cycleResetNeeded = true;
        }
      }

      if (cycleResetNeeded) {
        bill.status = "Unpaid";
        stateChanged = true;
      }
    }
  });

  if (stateChanged) {
    saveState();
  }
}

function calculateBillsDueBeforePayday() {
  evaluateRecurringBillCycles();
  if (!state.policy.nextPayday) return { total: 0.00, count: 0 };
  
  const paydayLimit = new Date(state.policy.nextPayday);
  let grossDueAUD = 0.00;
  let count = 0;

  state.bills.forEach(bill => {
    if (bill.status === "Paid") return;

    const dueDate = new Date(bill.dueDate);
    if (dueDate <= paydayLimit) {
      grossDueAUD = round2(grossDueAUD + getBillAmountInAUD(bill));
      count++;
    }
  });

  const netNeededAUD = Math.max(0.00, round2(grossDueAUD - state.accounts.bills));
  return { total: netNeededAUD, count };
}

// ==========================================
// 6. PAYDAY MISSION WORKFLOW
// ==========================================
const steps = {
  TAX: 1,
  BILLS: 2,
  EMERGENCY: 3,
  GOLD: 4,
  COMPLETE: 5
};

function initMission(income) {
  income.status = "Processing";
  saveState();

  executeTransfer("EXTERNAL", "Main", income.amount, `Income: ${income.source}`, { incomeId: income.id });

  state.activeMission = {
    incomeId: income.id,
    incomeAmount: round2(income.amount),
    incomeSource: income.source,
    taxDeducted: income.taxDeducted,
    step: steps.TAX,
    completedAllocations: { tax: 0, bills: 0, emergency: 0, gold: 0 }
  };
  
  saveState();
  navigateTo("paydayScreen");
  renderMission();
}

function renderMission() {
  const am = state.activeMission;
  if (!am) {
    document.getElementById("missionEmpty").classList.remove("hidden");
    document.getElementById("closePreviousMission").classList.add("hidden");
    document.getElementById("missionCard").classList.add("hidden");
    document.getElementById("missionComplete").classList.add("hidden");
    return;
  }

  document.getElementById("missionEmpty").classList.add("hidden");
  document.getElementById("closePreviousMission").classList.add("hidden"); 
  document.getElementById("missionHeading").textContent = `Mission: ${am.incomeSource}`;

  if (am.step === steps.COMPLETE) {
    document.getElementById("missionCard").classList.add("hidden");
    document.getElementById("missionComplete").classList.remove("hidden");
    
    document.getElementById("summaryTax").textContent = `$${am.completedAllocations.tax.toFixed(2)}`;
    document.getElementById("summaryBills").textContent = `$${am.completedAllocations.bills.toFixed(2)}`;
    document.getElementById("summaryEmergency").textContent = `$${am.completedAllocations.emergency.toFixed(2)}`;
    document.getElementById("summaryGold").textContent = `$${am.completedAllocations.gold.toFixed(2)}`;
    
    const finalSpendable = state.accounts.main;
    document.getElementById("missionProtectedUntil").innerHTML = `
      <div style="text-align: center; font-family: monospace; text-transform: uppercase;">
        <span style="color: #2ecc71; font-weight: bold; letter-spacing: 0.1em; font-size: 1.1rem; display: block; margin-bottom: 15px;">✔ MISSION COMPLETE</span>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 15px 0; text-align: left; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
          <span style="opacity:0.7">Tax Protected:</span><span style="color: #2ecc71; text-align: right">✔</span>
          <span style="opacity:0.7">Bills Funded:</span><span style="color: #2ecc71; text-align: right">✔</span>
          <span style="opacity:0.7">Emergency Buffer:</span><span style="color: #2ecc71; text-align: right">✔</span>
          <span style="opacity:0.7">Gold Growth:</span><span style="color: #2ecc71; text-align: right">✔</span>
        </div>
        <hr style="border: none; border-top: 1px dashed rgba(255,255,255,0.15); margin: 20px 0;">
        <div style="padding: 15px; background: rgba(46, 204, 113, 0.08); border-radius: 8px; border: 1px solid rgba(46, 204, 113, 0.2)">
          <span style="font-size: 0.85rem; letter-spacing: 0.05em; opacity: 0.8; display: block; margin-bottom: 6px;">AVAILABLE TO SPEND</span>
          <strong style="font-size: 2rem; color: #2ecc71; display: block; letter-spacing: -0.02em;">$${finalSpendable.toFixed(2)}</strong>
        </div>
      </div>
    `;
    return;
  }

  document.getElementById("missionCard").classList.remove("hidden");
  document.getElementById("missionComplete").classList.add("hidden");

  let stepLabel = "";
  let actionText = "";
  let recAmount = 0.00;
  let description = "";
  let explanation = "";

  const currentMain = state.accounts.main;

  switch (am.step) {
    case steps.TAX:
      stepLabel = "Step 1 of 4";
      actionText = "Reserve Tax";
      recAmount = am.taxDeducted === "Yes" ? 0.00 : round2(am.incomeAmount * (parseFloat(state.policy.taxRate) / 100));
      recAmount = Math.min(currentMain, recAmount);
      description = "Move tax allocation from Main to Tax account.";
      explanation = `Calculated at a ${state.policy.taxRate}% tax rate on your gross income of $${am.incomeAmount}.`;
      break;

    case steps.BILLS:
      stepLabel = "Step 2 of 4";
      actionText = "Fund Upcoming Bills";
      const billsNeeded = calculateBillsDueBeforePayday().total;
      recAmount = Math.min(currentMain, billsNeeded);
      description = "Transfer outstanding liabilities to your Bills account.";
      explanation = `Based on unpaid bills due before your next payday (${state.policy.nextPayday || "not set"}).`;
      break;

    case steps.EMERGENCY:
      stepLabel = "Step 3 of 4";
      actionText = "Build Emergency Fund";
      
      let emergencyPct = parseFloat(state.policy.stabilityEmergencyPct);
      if (state.policy.mode === "Growth") emergencyPct = parseFloat(state.policy.growthEmergencyPct);
      if (state.policy.mode === "Wealth") emergencyPct = parseFloat(state.policy.wealthEmergencyPct);

      recAmount = round2(currentMain * (emergencyPct / 100));
      recAmount = Math.min(currentMain, recAmount);
      description = "Commit defensive buffer allocation.";
      explanation = `Applying "${state.policy.mode}" mode policy strategy (${emergencyPct}% priority allocation of remaining Main balance).`;
      break;

    case steps.GOLD:
      stepLabel = "Step 4 of 4";
      actionText = "Fund Gold (Growth Asset)";
      recAmount = 0.00; 
      description = "Suggested: Move any amount you wish to Gold. Anything left stays in Main.";
      explanation = `No mandatory priority percentage. Leftover funds rest in your Main spending pool.`;
      break;
  }

  document.getElementById("missionStepLabel").textContent = stepLabel;
  document.getElementById("missionAction").textContent = actionText;
  document.getElementById("missionAmount").textContent = `$${recAmount.toFixed(2)}`;
  document.getElementById("missionDescription").textContent = description;
  document.getElementById("missionWhy").textContent = explanation;

  am.currentRecommendation = recAmount;
}

document.getElementById("missionAcceptBtn").addEventListener("click", () => {
  commitCurrentStep(state.activeMission.currentRecommendation);
});

document.getElementById("missionAdjustBtn").addEventListener("click", () => {
  document.getElementById("missionAdjustForm").classList.remove("hidden");
  document.getElementById("missionAdjustedAmount").value = state.activeMission.currentRecommendation.toFixed(2);
});

document.getElementById("missionAdjustForm").addEventListener("submit", (e) => {
  e.preventDefault();
  let adjustedVal = round2(parseFloat(document.getElementById("missionAdjustedAmount").value));
  
  const maxMain = state.accounts.main;
  if (adjustedVal > maxMain) adjustedVal = maxMain;
  if (adjustedVal < 0) adjustedVal = 0.00;

  document.getElementById("missionAdjustForm").classList.add("hidden");
  commitCurrentStep(adjustedVal);
});

document.getElementById("cancelMissionAdjustBtn").addEventListener("click", () => {
  document.getElementById("missionAdjustForm").classList.add("hidden");
});

function commitCurrentStep(amount) {
  const am = state.activeMission;
  if (!am) return;

  const amt = round2(Number(amount || 0));
  const metadata = {
    incomeId: am.incomeId,
    recommendedAmount: am.currentRecommendation
  };

  const completeZeroStep = (allocationKey, nextStep) => {
    am.completedAllocations[allocationKey] = 0;
    am.step = nextStep;
    saveState();
    renderMission();
  };

  if (am.step === steps.TAX) {
    if (amt === 0) return completeZeroStep("tax", steps.BILLS);
    const success = executeTransfer("Main", "Tax", amt, `Payday Tax: ${am.incomeSource}`, metadata);
    if (success) {
      am.completedAllocations.tax = amt;
      am.step = steps.BILLS;
    } else {
      alert("Transfer failed. Check the available balance in Main.");
    }
  } else if (am.step === steps.BILLS) {
    if (amt === 0) return completeZeroStep("bills", steps.EMERGENCY);
    const success = executeTransfer("Main", "Bills", amt, `Payday Bills: ${am.incomeSource}`, metadata);
    if (success) {
      am.completedAllocations.bills = amt;
      am.step = steps.EMERGENCY;
    } else {
      alert("Transfer failed. Check the available balance in Main.");
    }
  } else if (am.step === steps.EMERGENCY) {
    if (amt === 0) return completeZeroStep("emergency", steps.GOLD);
    const success = executeTransfer("Main", "Emergency", amt, `Payday Buffer: ${am.incomeSource}`, metadata);
    if (success) {
      am.completedAllocations.emergency = amt;
      am.step = steps.GOLD;
    } else {
      alert("Transfer failed. Check the available balance in Main.");
    }
  } else if (am.step === steps.GOLD) {
    if (amt > 0) {
      const success = executeTransfer("Main", "Gold", amt, `Payday Gold: ${am.incomeSource}`, metadata);
      if (!success) {
        alert("Transfer failed. Check the available balance in Main.");
        return;
      }
    }

    am.completedAllocations.gold = amt;
    const targetIncome = state.incomes.find(inc => inc.id === am.incomeId);
    if (targetIncome) targetIncome.status = "Processed";
    am.step = steps.COMPLETE;
  }

  saveState();
  renderMission();
}

document.getElementById("finishMissionBtn").addEventListener("click", () => {
  state.activeMission = null;
  saveState();
  navigateTo("homeScreen");
});

// ==========================================
// 7. ACCOUNT LEDGER RECONCILIATION & PAID DATE ADJUSTER
// ==========================================
window.markBillPaid = function(id) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill || bill.status === "Paid") return;

  const amountAUD = getBillAmountInAUD(bill);
  if (state.accounts.bills < amountAUD) {
    alert(`The Bills account contains $${state.accounts.bills.toFixed(2)}, but this bill requires $${amountAUD.toFixed(2)}.`);
    return;
  }

  const success = executeTransfer(
    "Bills",
    "EXTERNAL",
    amountAUD,
    `Bill paid: ${bill.name}`,
    { type: "BILL_PAYMENT", billId: bill.id }
  );

  if (success) {
    bill.status = "Paid";
    bill.lastPaidDate = new Date().toISOString();

    // Adjust the next calendar due date forward automatically
    const currentDueDate = new Date(bill.dueDate);
    if (!isNaN(currentDueDate.getTime())) {
      if (bill.recurring === "Weekly") {
        currentDueDate.setDate(currentDueDate.getDate() + 7);
      } else if (bill.recurring === "Fortnightly") {
        currentDueDate.setDate(currentDueDate.getDate() + 14);
      } else if (bill.recurring === "Monthly") {
        currentDueDate.setMonth(currentDueDate.getMonth() + 1);
      } else if (bill.recurring === "Yearly") {
        currentDueDate.setFullYear(currentDueDate.getFullYear() + 1);
      }
      
      bill.dueDate = currentDueDate.toISOString().split("T")[0];
    }

    if (bill.recurring !== "One-off") {
      bill.status = "Unpaid";
    }

    saveState();
  }
};

// ==========================================
// 8. DATA RENDERING & DISPLAY LOGIC
// ==========================================
function renderAll() {
  const mainHeader = document.querySelector("#homeScreen .hero-card h2");
  if (mainHeader) {
    mainHeader.innerHTML = `Available to Spend <span style="font-size: 0.8rem; display: block; font-weight: normal; opacity: 0.6; margin-top: 4px;">(Main Account)</span>`;
  }

  document.getElementById("homeMain").textContent = `$${state.accounts.main.toFixed(2)}`;
  document.getElementById("accMain").textContent = `$${state.accounts.main.toFixed(2)}`;
  document.getElementById("accBills").textContent = `$${state.accounts.bills.toFixed(2)}`;
  document.getElementById("accEmergency").textContent = `$${state.accounts.emergency.toFixed(2)}`;
  document.getElementById("accGold").textContent = `$${state.accounts.gold.toFixed(2)}`;
  document.getElementById("accTax").textContent = `$${state.accounts.tax.toFixed(2)}`;

  const safeSpendEl = document.getElementById("homeSafeSpend");
  if (safeSpendEl) safeSpendEl.textContent = `$${state.accounts.main.toFixed(2)}`;

  const billsData = calculateBillsDueBeforePayday();
  document.getElementById("homeBills").textContent = `$${billsData.total.toFixed(2)}`;
  document.getElementById("billsDueBeforePayday").textContent = `$${billsData.total.toFixed(2)}`;
  document.getElementById("billsDueCount").textContent = billsData.count;

  const emPercent = state.policy.emergencyTarget > 0 ? (state.accounts.emergency / state.policy.emergencyTarget) * 100 : 0;
  const goldPercent = state.policy.goldTarget > 0 ? (state.accounts.gold / state.policy.goldTarget) * 100 : 0;

  document.getElementById("homeEmergency").textContent = `$${state.accounts.emergency.toFixed(2)}`;
  document.getElementById("homeEmergencySub").textContent = `${Math.min(100, emPercent).toFixed(0)}% of target`;
  document.getElementById("homeGold").textContent = `$${state.accounts.gold.toFixed(2)}`;
  document.getElementById("homeGoldSub").textContent = `${Math.min(100, goldPercent).toFixed(0)}% of target`;

  const nextUp = state.incomes.find(inc => !inc.status || inc.status === "Pending");

  if (nextUp && !state.activeMission) {
    document.getElementById("missionStateDot").className = "health-dot warning";
    document.getElementById("missionStateTitle").textContent = "Active Mission Pending";
    document.getElementById("missionStateSub").textContent = `Incoming payload "${nextUp.source}" ready to route.`;
    document.getElementById("missionIncomeSource").textContent = nextUp.source;
    document.getElementById("missionIncomeAmount").textContent = `$${nextUp.amount.toFixed(2)}`;
    document.getElementById("startMissionBtn").onclick = () => initMission(nextUp);
  } else {
    document.getElementById("missionStateDot").className = "health-dot success";
    document.getElementById("missionStateTitle").textContent = "All Systems Clear";
    document.getElementById("missionStateSub").textContent = "All income sources logged to Main ledger.";
    document.getElementById("missionIncomeSource").textContent = "—";
    document.getElementById("missionIncomeAmount").textContent = "$0";
    document.getElementById("startMissionBtn").onclick = null;
  }

  renderBillsList();
  renderIncomeList();
  renderTransferHistory();
}

function renderBillsList() {
  const container = document.getElementById("billsList");
  container.innerHTML = "";
  if (state.bills.length === 0) {
    container.innerHTML = `<div class="empty-state">No bills entered.</div>`;
    return;
  }

  state.bills.forEach(bill => {
    const audValue = getBillAmountInAUD(bill);
    const isPaid = bill.status === "Paid";
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${bill.name} (${bill.status || "Unpaid"})</strong>
        <p>${bill.dueDate} (${bill.recurring})</p>
      </div>
      <div class="right">
        <strong>$${audValue.toFixed(2)} AUD</strong>
        ${bill.currency !== "AUD" ? `<small>${bill.amount} ${bill.currency}</small>` : ""}
        <div>
          ${!isPaid ? `<button class="text-btn success-text" style="margin-right:8px;" onclick="markBillPaid('${bill.id}')">Mark Paid</button>` : ""}
          <button class="text-btn primary-text" onclick="editBill('${bill.id}')">Edit</button>
          <button class="text-btn danger-text" onclick="deleteBill('${bill.id}')">Remove</button>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderIncomeList() {
  const container = document.getElementById("incomeList");
  container.innerHTML = "";
  if (state.incomes.length === 0) {
    container.innerHTML = `<div class="empty-state">No income records.</div>`;
    return;
  }

  state.incomes.forEach(inc => {
    const isProcessed = inc.status === "Processed" || inc.status === "Processing";
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${inc.source} ${isProcessed ? `[${inc.status}]` : "[Unprocessed]"}</strong>
        <p>${inc.date} | Gross Tax Deducted: ${inc.taxDeducted}</p>
      </div>
      <div class="right">
        <strong>$${inc.amount.toFixed(2)} AUD</strong>
        <div>
          ${!isProcessed ? `<button class="text-btn primary-text" onclick="editIncome('${inc.id}')">Edit</button>` : ""}
          <button class="text-btn danger-text" onclick="deleteIncome('${inc.id}')">Delete</button>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderTransferHistory() {
  const container = document.getElementById("transferHistory");
  container.innerHTML = "";
  if (state.transfers.length === 0) {
    container.innerHTML = `<div class="empty-state">No recorded movements.</div>`;
    return;
  }

  state.transfers.forEach(t => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div>
        <strong>${t.memo}</strong>
        <p>${t.date} | ${t.from} → ${t.to}</p>
      </div>
      <div class="right">
        <strong style="color: ${t.type === "RECONCILIATION" ? "#3498db" : "inherit"}">
          ${t.type === "RECONCILIATION" ? "RECONCILE: " : ""}$${t.amount.toFixed(2)} AUD
        </strong>
      </div>
    `;
    container.appendChild(item);
  });
}

// ==========================================
// 9. DATA MODIFICATION & HANDLERS
// ==========================================
window.editBill = function(id) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;

  document.getElementById("billName").value = bill.name;
  document.getElementById("billCurrency").value = bill.currency;
  document.getElementById("billAmount").value = bill.amount;
  document.getElementById("billCategory").value = bill.category;
  document.getElementById("billDueDate").value = bill.dueDate;
  document.getElementById("billRecurring").value = bill.recurring;

  document.getElementById("billForm").dataset.editId = id;
  document.getElementById("billFormWrap").classList.remove("hidden");
};

window.deleteBill = function(id) {
  state.bills = state.bills.filter(b => b.id !== id);
  saveState();
};

window.editIncome = function(id) {
  const inc = state.incomes.find(i => i.id === id);
  if (!inc || inc.status === "Processed" || inc.status === "Processing") return;

  document.getElementById("incomeSource").value = inc.source;
  document.getElementById("incomeAmount").value = inc.amount;
  document.getElementById("incomeDate").value = inc.date;
  document.getElementById("taxDeducted").value = inc.taxDeducted;

  document.getElementById("incomeForm").dataset.editId = id;
};

window.deleteIncome = function(id) {
  const inc = state.incomes.find(i => i.id === id);
  if (!inc) return;

  if (inc.status === "Processed" || inc.status === "Processing") {
    const associatedTransfers = state.transfers.filter(t => t.incomeId === id);
    
    let simulatedBalances = {
      main: state.accounts.main,
      tax: state.accounts.tax,
      bills: state.accounts.bills,
      emergency: state.accounts.emergency,
      gold: state.accounts.gold
    };

    let canSafelyReverse = true;
    let failingAccountName = "";
    let deficientAmountNeeded = 0;

    associatedTransfers.forEach(t => {
      if (t.from === "Main" && t.to !== "EXTERNAL") {
        const destKey = t.to.toLowerCase();
        simulatedBalances[destKey] = round2(simulatedBalances[destKey] - t.amount);
        simulatedBalances.main = round2(simulatedBalances.main + t.amount);

        if (simulatedBalances[destKey] < 0) {
          canSafelyReverse = false;
          failingAccountName = t.to;
          deficientAmountNeeded = Math.abs(simulatedBalances[destKey]);
        }
      }
    });

    associatedTransfers.forEach(t => {
      if (t.from === "EXTERNAL" && t.to === "Main") {
        simulatedBalances.main = round2(simulatedBalances.main - t.amount);
        if (simulatedBalances.main < 0) {
          canSafelyReverse = false;
          failingAccountName = "Main (Available to Spend)";
          deficientAmountNeeded = Math.abs(simulatedBalances.main);
        }
      }
    });

    if (!canSafelyReverse) {
      alert(`Ledger Reversal Aborted!\n\nCannot safely reverse this income because the "${failingAccountName}" account does not contain enough funds. You are short by $${deficientAmountNeeded.toFixed(2)} AUD.\n\nPlease top up this account before attempting deletion.`);
      return;
    }

    if (confirm("Are you sure you want to delete this income? Doing so will safely reverse the transaction ledger across your target portfolios.")) {
      state.accounts.main = simulatedBalances.main;
      state.accounts.tax = simulatedBalances.tax;
      state.accounts.bills = simulatedBalances.bills;
      state.accounts.emergency = simulatedBalances.emergency;
      state.accounts.gold = simulatedBalances.gold;

      state.transfers = state.transfers.filter(t => t.incomeId !== id);

      if (state.activeMission && state.activeMission.incomeId === id) {
        state.activeMission = null;
      }
    } else {
      return;
    }
  }

  state.incomes = state.incomes.filter(i => i.id !== id);
  saveState();
};

document.getElementById("incomeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const editId = document.getElementById("incomeForm").dataset.editId;
  const sourceVal = document.getElementById("incomeSource").value;
  const amountVal = round2(parseFloat(document.getElementById("incomeAmount").value));
  const dateVal = document.getElementById("incomeDate").value;
  const taxDeductedVal = document.getElementById("taxDeducted").value;

  if (editId) {
    const inc = state.incomes.find(i => i.id === editId);
    if (inc && inc.status !== "Processed" && inc.status !== "Processing") {
      inc.source = sourceVal;
      inc.amount = amountVal;
      inc.date = dateVal;
      inc.taxDeducted = taxDeductedVal;
    }
    delete document.getElementById("incomeForm").dataset.editId;
  } else {
    const inc = {
      id: Date.now().toString(),
      source: sourceVal,
      amount: amountVal,
      date: dateVal,
      taxDeducted: taxDeductedVal,
      status: "Pending"
    };
    state.incomes.push(inc);
  }

  saveState();
  document.getElementById("incomeForm").reset();
});

document.getElementById("billForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const editId = document.getElementById("billForm").dataset.editId;
  const billData = {
    name: document.getElementById("billName").value,
    currency: document.getElementById("billCurrency").value,
    amount: round2(parseFloat(document.getElementById("billAmount").value)),
    category: document.getElementById("billCategory").value,
    dueDate: document.getElementById("billDueDate").value,
    recurring: document.getElementById("billRecurring").value,
    status: "Unpaid"
  };

  if (editId) {
    const bill = state.bills.find(b => b.id === editId);
    if (bill) {
      bill.name = billData.name;
      bill.currency = billData.currency;
      bill.amount = billData.amount;
      bill.category = billData.category;
      bill.dueDate = billData.dueDate;
      bill.recurring = billData.recurring;
    }
    delete document.getElementById("billForm").dataset.editId;
  } else {
    billData.id = Date.now().toString();
    state.bills.push(billData);
  }

  saveState();
  document.getElementById("billForm").reset();
  document.getElementById("billFormWrap").classList.add("hidden");
});

document.getElementById("toggleBillFormBtn").addEventListener("click", () => {
  delete document.getElementById("billForm").dataset.editId;
  document.getElementById("billForm").reset();
  document.getElementById("billFormWrap").classList.toggle("hidden");
});

document.getElementById("cancelBillEditBtn").addEventListener("click", () => {
  delete document.getElementById("billForm").dataset.editId;
  document.getElementById("billFormWrap").classList.add("hidden");
});

document.getElementById("mainReconcileForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const targetVal = round2(parseFloat(document.getElementById("actualMainBalance").value));
  const difference = round2(targetVal - state.accounts.main);

  if (difference !== 0) {
    executeTransfer("SYSTEM", "Main", difference, "Manual Ledger Reconciliation", { type: "RECONCILIATION" });
  }
  document.getElementById("mainReconcileForm").reset();
});

document.getElementById("settingsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  state.policy.mode = document.getElementById("mode").value;
  state.policy.taxRate = parseFloat(document.getElementById("taxRate").value);
  state.policy.emergencyTarget = parseFloat(document.getElementById("emergencyTarget").value);
  state.policy.goldTarget = parseFloat(document.getElementById("goldTarget").value);
  state.policy.exchangeRate = parseFloat(document.getElementById("exchangeRate").value);
  state.policy.stabilityEmergencyPct = parseFloat(document.getElementById("stabilityEmergencyPct").value);
  state.policy.growthEmergencyPct = parseFloat(document.getElementById("growthEmergencyPct").value);
  state.policy.wealthEmergencyPct = parseFloat(document.getElementById("wealthEmergencyPct").value);
  state.policy.nextPayday = document.getElementById("nextPayday").value;

  saveState();
  alert("Financial Policy configuration updated.");
});

document.getElementById("resetBtn").addEventListener("click", () => {
  if (confirm("Reset FOS? All ledger entries and accounts will be wiped clean.")) {
    localStorage.removeItem("fos_state");
    location.reload();
  }
});

// ==========================================
// 10. INITIALIZATION ON PAGE LOAD
// ==========================================
window.onload = async () => {
  await loadState();

  document.getElementById("mode").value = state.policy.mode;
  document.getElementById("taxRate").value = state.policy.taxRate;
  document.getElementById("emergencyTarget").value = state.policy.emergencyTarget;
  document.getElementById("goldTarget").value = state.policy.goldTarget;
  document.getElementById("exchangeRate").value = state.policy.exchangeRate;
  document.getElementById("stabilityEmergencyPct").value = state.policy.stabilityEmergencyPct;
  document.getElementById("growthEmergencyPct").value = state.policy.growthEmergencyPct;
  document.getElementById("wealthEmergencyPct").value = state.policy.wealthEmergencyPct;
  document.getElementById("nextPayday").value = state.policy.nextPayday;

  const oldLifestyleInput = document.getElementById("lifestyleAllowance");
  if (oldLifestyleInput) {
    const parentFormRow = oldLifestyleInput.closest(".form-group") || oldLifestyleInput.parentNode;
    if (parentFormRow) parentFormRow.style.display = "none";
  }
  const oldGoldInput = document.getElementById("goldPct");
  if (oldGoldInput) {
    const parentFormRow = oldGoldInput.closest(".form-group") || oldGoldInput.parentNode;
    if (parentFormRow) parentFormRow.style.display = "none";
  }
};