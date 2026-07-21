// FOS — Personal Financial Operating System
// GitHub Pages / localStorage edition

const STORAGE_KEY = "fos_state";
const LEGACY_KEYS = ["fos_data", "fos_state_v2", "fos_app_state", "fosState"];

const DEFAULT_STATE = {
  accounts: { main: 0, bills: 0, tax: 0, emergency: 0, gold: 0 },
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
  activeMission: null,
  schemaVersion: 4
};

let state = clone(DEFAULT_STATE);
let saveTimer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}
function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [y,m,d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}
function toDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function normalizeFrequency(value) {
  const v = String(value || "Monthly").trim().toLowerCase();
  if (["one-time", "one time", "one-off", "one off", "once"].includes(v)) return "One-off";
  if (v === "weekly") return "Weekly";
  if (v === "fortnightly" || v === "biweekly" || v === "bi-weekly") return "Fortnightly";
  if (v === "quarterly") return "Quarterly";
  if (["six-monthly", "six monthly", "semiannual", "semi-annual"].includes(v)) return "Six-monthly";
  if (["yearly", "annual", "annually"].includes(v)) return "Yearly";
  return "Monthly";
}
function addCycle(dateString, frequency) {
  const date = parseDateOnly(dateString);
  if (!date) return dateString;
  switch (normalizeFrequency(frequency)) {
    case "Weekly": date.setDate(date.getDate() + 7); break;
    case "Fortnightly": date.setDate(date.getDate() + 14); break;
    case "Monthly": date.setMonth(date.getMonth() + 1); break;
    case "Quarterly": date.setMonth(date.getMonth() + 3); break;
    case "Six-monthly": date.setMonth(date.getMonth() + 6); break;
    case "Yearly": date.setFullYear(date.getFullYear() + 1); break;
    default: return dateString;
  }
  return toDateOnly(date);
}

function migrateState(raw) {
  const next = clone(DEFAULT_STATE);
  if (!raw || typeof raw !== "object") return next;
  if (raw.accounts && typeof raw.accounts === "object") {
    for (const key of Object.keys(next.accounts)) next.accounts[key] = round2(raw.accounts[key]);
  }
  if (raw.policy && typeof raw.policy === "object") Object.assign(next.policy, raw.policy);
  next.policy.taxRate = round2(next.policy.taxRate);
  next.policy.exchangeRate = Math.max(0.0001, Number(next.policy.exchangeRate) || 32.5);
  next.incomes = Array.isArray(raw.incomes) ? raw.incomes.map(i => ({
    id: String(i.id || `INC-${Date.now()}-${Math.random()}`),
    source: String(i.source || "Income"), amount: round2(i.amount),
    date: i.date || todayISO(), taxDeducted: i.taxDeducted === "Yes" ? "Yes" : "No",
    status: ["Pending","Processing","Processed"].includes(i.status) ? i.status : "Pending"
  })) : [];
  next.bills = Array.isArray(raw.bills) ? raw.bills.map(b => ({
    id: String(b.id || `BILL-${Date.now()}-${Math.random()}`),
    name: String(b.name || "Bill"), currency: b.currency === "EGP" ? "EGP" : "AUD",
    amount: round2(b.amount), category: String(b.category || "Living"),
    dueDate: b.dueDate || todayISO(), recurring: normalizeFrequency(b.recurring),
    status: b.status === "Paid" ? "Paid" : "Unpaid",
    lastPaidDate: b.lastPaidDate || null,
    paidForDueDate: b.paidForDueDate || null
  })) : [];
  next.transfers = Array.isArray(raw.transfers) ? raw.transfers : [];
  next.activeMission = raw.activeMission && typeof raw.activeMission === "object" ? raw.activeMission : null;
  next.schemaVersion = 4;
  return next;
}

function loadState() {
  let rawText = localStorage.getItem(STORAGE_KEY);
  if (!rawText) {
    for (const key of LEGACY_KEYS) {
      rawText = localStorage.getItem(key);
      if (rawText) break;
    }
  }
  if (rawText) {
    try { state = migrateState(JSON.parse(rawText)); }
    catch (error) { console.error("FOS saved data could not be parsed; defaults loaded without deleting the old data.", error); }
  }
  unlockDueRecurringBills();
  persistState(false);
}
function persistState(render = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(`${STORAGE_KEY}_backup`, JSON.stringify(state));
  } catch (error) { console.error("Unable to save FOS data", error); }
  if (render) renderAll();
}
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistState(true), 0);
}
window.addEventListener("pagehide", () => persistState(false));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistState(false); });

function notify(message) { alert(message); }

function executeTransfer(from, to, amount, memo, metadata = {}) {
  const amt = round2(amount);
  if (metadata.type !== "RECONCILIATION" && amt <= 0) return false;
  if (metadata.type === "RECONCILIATION") {
    state.accounts.main = amt;
  } else {
    if (from !== "EXTERNAL" && from !== "SYSTEM") {
      const key = from.toLowerCase();
      if (!(key in state.accounts) || state.accounts[key] + 0.0001 < amt) return false;
      state.accounts[key] = round2(state.accounts[key] - amt);
    }
    if (to !== "EXTERNAL" && to !== "SYSTEM") {
      const key = to.toLowerCase();
      if (!(key in state.accounts)) return false;
      state.accounts[key] = round2(state.accounts[key] + amt);
    }
  }
  state.transfers.unshift({
    id: `TX-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
    date: todayISO(), from: metadata.type === "RECONCILIATION" ? "SYSTEM" : from,
    to: metadata.type === "RECONCILIATION" ? "Main" : to,
    amount: Math.abs(amt), type: metadata.type || "TRANSFER", memo,
    incomeId: metadata.incomeId || null, billId: metadata.billId || null
  });
  return true;
}

const screens = document.querySelectorAll(".screen");
const navButtons = document.querySelectorAll(".bottom-nav button");
navButtons.forEach(btn => btn.addEventListener("click", () => navigateTo(btn.dataset.screen)));
function navigateTo(screenId) {
  screens.forEach(s => s.classList.toggle("active", s.id === screenId));
  navButtons.forEach(b => b.classList.toggle("active", b.dataset.screen === screenId));
}

document.addEventListener("click", event => { if (event.target?.id === "backHomeBtn") navigateTo("homeScreen"); });

function getBillAmountInAUD(bill) {
  const amount = round2(bill.amount);
  return bill.currency === "EGP" ? round2(amount / Math.max(0.0001, Number(state.policy.exchangeRate) || 32.5)) : amount;
}
function unlockDueRecurringBills() {
  const today = todayISO();
  let changed = false;
  state.bills.forEach(bill => {
    bill.recurring = normalizeFrequency(bill.recurring);
    if (bill.status === "Paid" && bill.recurring !== "One-off" && bill.dueDate <= today) {
      bill.status = "Unpaid";
      changed = true;
    }
  });
  return changed;
}
function getExpectedIncomes() {
  return state.incomes
    .filter(i => i.status === "Pending" && parseDateOnly(i.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function getNextExpectedIncome() {
  return getExpectedIncomes()[0] || null;
}

function formatDisplayDate(value) {
  const date = parseDateOnly(value);
  if (!date) return String(value || "—");
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
function getUnpaidBillsInWindow(startDateValue, endDateValue) {
  const start = parseDateOnly(startDateValue);
  const end = parseDateOnly(endDateValue);
  if (!start) return [];
  const results = [];
  for (const bill of state.bills) {
    if (bill.status === "Paid") continue;
    let due = parseDateOnly(bill.dueDate);
    if (!due) continue;
    const frequency = normalizeFrequency(bill.recurring);
    let guard = 0;
    while (due && guard < 1000) {
      const afterStart = due >= start;
      const beforeEnd = !end || due < end;
      if (afterStart && beforeEnd) {
        results.push({ bill, dueDate: toDateOnly(due), amount: getBillAmountInAUD(bill) });
      }
      if (end && due >= end) break;
      if (frequency === "One-off") break;
      const next = addCycle(toDateOnly(due), frequency);
      if (next === toDateOnly(due)) break;
      due = parseDateOnly(next);
      guard += 1;
    }
  }
  return results.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
}
function getMissionQueueItems() {
  const pending = getExpectedIncomes();
  const items = [];
  if (state.activeMission) {
    const income = state.incomes.find(i => i.id === state.activeMission.incomeId);
    const nextPending = pending[0] || null;
    items.push({
      income: income || { id: state.activeMission.incomeId, source: state.activeMission.incomeSource, amount: state.activeMission.incomeAmount, date: todayISO() },
      status: "active",
      nextIncome: nextPending
    });
  }
  pending.forEach((income, index) => {
    items.push({
      income,
      status: !state.activeMission && index === 0 && income.date <= todayISO() ? "ready" : "waiting",
      nextIncome: pending[index + 1] || null
    });
  });
  return items;
}
function calculateBillsDueBeforePayday(paydayValue = null) {
  const nextIncome = getNextExpectedIncome();
  const payday = parseDateOnly(paydayValue || nextIncome?.date || state.policy.nextPayday);
  if (!payday) return { gross: 0, total: 0, count: 0 };
  let gross = 0, count = 0;
  for (const bill of state.bills) {
    if (bill.status === "Paid") continue;
    let due = parseDateOnly(bill.dueDate);
    if (!due || due > payday) continue;
    const frequency = normalizeFrequency(bill.recurring);
    if (frequency === "One-off") {
      gross += getBillAmountInAUD(bill); count += 1; continue;
    }
    let guard = 0;
    while (due <= payday && guard < 1000) {
      gross += getBillAmountInAUD(bill); count += 1; guard += 1;
      const next = addCycle(toDateOnly(due), frequency);
      if (next === toDateOnly(due)) break;
      due = parseDateOnly(next);
      if (!due) break;
    }
  }
  gross = round2(gross);
  return { gross, total: Math.max(0, round2(gross - state.accounts.bills)), count };
}

const steps = { TAX:1, BILLS:2, EMERGENCY:3, GOLD:4, COMPLETE:5 };
function initMission(income) {
  if (state.activeMission) { navigateTo("paydayScreen"); return; }
  if (income.status === "Processed") return;
  const alreadyCredited = state.transfers.some(t => t.incomeId === income.id && t.from === "EXTERNAL" && t.to === "Main");
  if (!alreadyCredited) {
    if (!executeTransfer("EXTERNAL", "Main", income.amount, `Income: ${income.source}`, { incomeId: income.id })) return;
  }
  income.status = "Processing";
  state.activeMission = {
    incomeId: income.id, incomeAmount: round2(income.amount), incomeSource: income.source,
    taxDeducted: income.taxDeducted, step: steps.TAX,
    completedAllocations: { tax:0, bills:0, emergency:0, gold:0 }, currentRecommendation: 0
  };
  persistState(); navigateTo("paydayScreen");
}
function renderMission() {
  const am = state.activeMission;
  const empty = document.getElementById("missionEmpty");
  const previous = document.getElementById("closePreviousMission");
  const card = document.getElementById("missionCard");
  const complete = document.getElementById("missionComplete");
  if (!am) {
    empty?.classList.remove("hidden"); previous?.classList.add("hidden"); card?.classList.add("hidden"); complete?.classList.add("hidden"); return;
  }
  empty?.classList.add("hidden"); previous?.classList.add("hidden");
  document.getElementById("missionHeading").textContent = `Mission: ${am.incomeSource}`;
  if (am.step === steps.COMPLETE) {
    card.classList.add("hidden"); complete.classList.remove("hidden");
    document.getElementById("summaryTax").textContent = `$${round2(am.completedAllocations.tax).toFixed(2)}`;
    document.getElementById("summaryBills").textContent = `$${round2(am.completedAllocations.bills).toFixed(2)}`;
    document.getElementById("summaryEmergency").textContent = `$${round2(am.completedAllocations.emergency).toFixed(2)}`;
    document.getElementById("summaryGold").textContent = `$${round2(am.completedAllocations.gold).toFixed(2)}`;
    document.getElementById("missionProtectedUntil").innerHTML = `<div style="text-align:center"><strong style="color:#2ecc71">✔ MISSION COMPLETE</strong><p>Available to spend: <strong>$${state.accounts.main.toFixed(2)}</strong></p></div>`;
    return;
  }
  card.classList.remove("hidden"); complete.classList.add("hidden");
  const main = state.accounts.main;
  let stepLabel="", action="", rec=0, description="", why="";
  if (am.step === steps.TAX) {
    stepLabel="Step 1 of 4"; action="Reserve Tax";
    rec = am.taxDeducted === "Yes" ? 0 : Math.min(main, round2(am.incomeAmount * Number(state.policy.taxRate) / 100));
    description="Move tax allocation from Main to Tax account."; why=`Calculated at ${state.policy.taxRate}% of this income.`;
  } else if (am.step === steps.BILLS) {
    stepLabel="Step 2 of 4"; action="Fund Upcoming Bills";
    rec = Math.min(main, calculateBillsDueBeforePayday().total);
    description="Transfer only the outstanding Bills-account deficit."; why="Existing Bills balance is deducted from the amount required before payday.";
  } else if (am.step === steps.EMERGENCY) {
    stepLabel="Step 3 of 4"; action="Build Emergency Fund";
    let pct = Number(state.policy.stabilityEmergencyPct);
    if (state.policy.mode === "Growth") pct = Number(state.policy.growthEmergencyPct);
    if (state.policy.mode === "Wealth") pct = Number(state.policy.wealthEmergencyPct);
    const targetGap = Math.max(0, round2(Number(state.policy.emergencyTarget) - state.accounts.emergency));
    rec = Math.min(main, targetGap, round2(main * pct / 100));
    description="Commit a defensive buffer allocation."; why=`${state.policy.mode} mode: ${pct}% of remaining Main, capped at the emergency target.`;
  } else {
    stepLabel="Step 4 of 4"; action="Fund Gold"; rec=0;
    description="Choose any amount for Gold; the remainder stays in Main."; why="This step is optional.";
  }
  am.currentRecommendation = round2(rec);
  document.getElementById("missionStepLabel").textContent=stepLabel;
  document.getElementById("missionAction").textContent=action;
  document.getElementById("missionAmount").textContent=`$${am.currentRecommendation.toFixed(2)}`;
  document.getElementById("missionDescription").textContent=description;
  document.getElementById("missionWhy").textContent=why;
}
function commitCurrentStep(value) {
  const am = state.activeMission; if (!am) return;
  const amt = Math.max(0, Math.min(state.accounts.main, round2(value)));
  let key, to, memo, next;
  if (am.step === steps.TAX) { key="tax"; to="Tax"; memo="Payday Tax"; next=steps.BILLS; }
  else if (am.step === steps.BILLS) { key="bills"; to="Bills"; memo="Payday Bills"; next=steps.EMERGENCY; }
  else if (am.step === steps.EMERGENCY) { key="emergency"; to="Emergency"; memo="Payday Buffer"; next=steps.GOLD; }
  else { key="gold"; to="Gold"; memo="Payday Gold"; next=steps.COMPLETE; }
  if (amt > 0 && !executeTransfer("Main", to, amt, `${memo}: ${am.incomeSource}`, { incomeId:am.incomeId })) {
    notify("Transfer failed. Check the available Main balance."); return;
  }
  am.completedAllocations[key] = amt; am.step = next;
  if (next === steps.COMPLETE) {
    const income = state.incomes.find(i => i.id === am.incomeId); if (income) income.status="Processed";
  }
  persistState(); renderMission();
}
document.getElementById("missionAcceptBtn")?.addEventListener("click", () => commitCurrentStep(state.activeMission?.currentRecommendation || 0));
document.getElementById("missionAdjustBtn")?.addEventListener("click", () => {
  document.getElementById("missionAdjustForm").classList.remove("hidden");
  document.getElementById("missionAdjustedAmount").value=(state.activeMission?.currentRecommendation || 0).toFixed(2);
});
document.getElementById("missionAdjustForm")?.addEventListener("submit", e => { e.preventDefault(); document.getElementById("missionAdjustForm").classList.add("hidden"); commitCurrentStep(document.getElementById("missionAdjustedAmount").value); });
document.getElementById("cancelMissionAdjustBtn")?.addEventListener("click", () => document.getElementById("missionAdjustForm").classList.add("hidden"));
document.getElementById("finishMissionBtn")?.addEventListener("click", () => { state.activeMission=null; persistState(); navigateTo("homeScreen"); });

window.markBillPaid = function(id) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill || bill.status === "Paid") return;
  const amount = getBillAmountInAUD(bill);
  if (state.accounts.bills + 0.0001 < amount) { notify(`The Bills account contains $${state.accounts.bills.toFixed(2)}, but this bill requires $${amount.toFixed(2)}.`); return; }
  const paidDueDate = bill.dueDate;
  if (!executeTransfer("Bills", "EXTERNAL", amount, `Bill paid: ${bill.name}`, { type:"BILL_PAYMENT", billId:bill.id })) return;
  bill.status="Paid"; bill.lastPaidDate=new Date().toISOString(); bill.paidForDueDate=paidDueDate;
  if (normalizeFrequency(bill.recurring) !== "One-off") bill.dueDate=addCycle(paidDueDate, bill.recurring);
  persistState();
};

function renderAll() {
  unlockDueRecurringBills();
  const $ = id => document.getElementById(id);
  if ($("homeMain")) $("homeMain").textContent=`$${state.accounts.main.toFixed(2)}`;
  for (const [id,key] of [["accMain","main"],["accBills","bills"],["accEmergency","emergency"],["accGold","gold"],["accTax","tax"]]) if ($(id)) $(id).textContent=`$${state.accounts[key].toFixed(2)}`;
  if ($("accLifestyle")) $("accLifestyle").textContent=`$${state.accounts.main.toFixed(2)}`;
  if ($("homeSafeSpend")) $("homeSafeSpend").textContent=`$${state.accounts.main.toFixed(2)}`;
  const due=calculateBillsDueBeforePayday();
  if ($("homeBills")) $("homeBills").textContent=`$${due.total.toFixed(2)}`;
  if ($("billsDueBeforePayday")) $("billsDueBeforePayday").textContent=`$${due.total.toFixed(2)}`;
  if ($("billsDueCount")) $("billsDueCount").textContent=due.count;
  if ($("homeEmergency")) $("homeEmergency").textContent=`$${state.accounts.emergency.toFixed(2)}`;
  if ($("homeGold")) $("homeGold").textContent=`$${state.accounts.gold.toFixed(2)}`;
  if ($("homeEmergencySub")) $("homeEmergencySub").textContent=`${Math.min(100, state.policy.emergencyTarget ? state.accounts.emergency/state.policy.emergencyTarget*100 : 0).toFixed(0)}% of target`;
  if ($("homeGoldSub")) $("homeGoldSub").textContent=`${Math.min(100, state.policy.goldTarget ? state.accounts.gold/state.policy.goldTarget*100 : 0).toFixed(0)}% of target`;
  const expectedIncomes = getExpectedIncomes();
  const pending = expectedIncomes[0];
  if (pending && !state.activeMission) {
    const isDue = pending.date <= todayISO();
    $("missionStateDot").className=`health-dot ${isDue ? "warning" : "success"}`;
    $("missionStateTitle").textContent=isDue ? "Income Ready" : "Next Expected Income";
    $("missionStateSub").textContent=isDue
      ? `“${pending.source}” can now be processed.`
      : `${pending.source} is expected on ${formatDisplayDate(pending.date)}.`;
    $("missionIncomeSource").textContent=pending.source;
    $("missionIncomeAmount").textContent=`$${pending.amount.toFixed(2)}`;
    $("startMissionBtn").textContent=isDue ? "Start Mission" : "Mark Received & Start";
    $("startMissionBtn").onclick=()=>initMission(pending);
  } else {
    $("missionStateDot").className="health-dot success"; $("missionStateTitle").textContent="All Systems Clear";
    $("missionStateSub").textContent=state.activeMission ? "A payday mission is in progress." : "All income sources are allocated.";
    $("missionIncomeSource").textContent="—"; $("missionIncomeAmount").textContent="$0"; $("startMissionBtn").textContent=state.activeMission ? "Open Mission" : "Start Mission"; $("startMissionBtn").onclick=state.activeMission ? ()=>navigateTo("paydayScreen") : null;
  }
  renderMissionQueue(); renderMission(); renderBillsList(); renderIncomeList(); renderTransferHistory();
}
function escapeHTML(v) { return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function renderMissionQueue() {
  const container = document.getElementById("missionQueue");
  const totalEl = document.getElementById("expectedIncomeTotal");
  if (!container) return;
  const pending = getExpectedIncomes();
  const total = pending.reduce((sum, income) => sum + round2(income.amount), 0);
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
  const items = getMissionQueueItems();
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="queue-empty">No missions are waiting. Add an expected income on the Payday screen.</div>';
    return;
  }
  items.forEach((item, index) => {
    const income = item.income;
    const windowStart = income.date || todayISO();
    const windowEnd = item.nextIncome?.date || null;
    const bills = getUnpaidBillsInWindow(windowStart, windowEnd);
    const totalBills = round2(bills.reduce((sum, entry) => sum + entry.amount, 0));
    const statusText = item.status === "active" ? "Active mission" : item.status === "ready" ? "Payment due — ready to start" : index === 0 && !state.activeMission ? "Next mission" : "Waiting";
    const protectionText = windowEnd ? `Bills until ${formatDisplayDate(windowEnd)}` : "Bills after this income";
    const billChips = bills.length
      ? bills.slice(0, 4).map(entry => `<span class="queue-bill-chip ${entry.dueDate < todayISO() ? "overdue" : ""}">${escapeHTML(entry.bill.name)} · ${formatDisplayDate(entry.dueDate)}</span>`).join("") + (bills.length > 4 ? `<span class="queue-bill-chip">+${bills.length - 4} more</span>` : "")
      : '<span class="queue-bill-chip">No unpaid bills in this period</span>';
    const card = document.createElement("article");
    card.className = `queue-card ${item.status === "active" ? "active" : ""}`;
    card.innerHTML = `<div class="queue-card-head"><div class="queue-card-title"><span class="queue-position">${index + 1}</span><div><h3>${escapeHTML(income.source)}</h3><p>${formatDisplayDate(income.date)}</p><span class="queue-status ${item.status}">${statusText}</span></div></div><div class="queue-amount">$${round2(income.amount).toFixed(2)}</div></div><div class="queue-bills"><div class="queue-bills-summary"><strong>${protectionText}</strong><span>${bills.length} bill${bills.length === 1 ? "" : "s"} · $${totalBills.toFixed(2)}</span></div><div class="queue-bills-list">${billChips}</div></div>`;
    container.appendChild(card);
  });
}

function renderBillsList() {
  const c=document.getElementById("billsList"); c.innerHTML="";
  if (!state.bills.length) { c.innerHTML='<div class="empty-state">No bills entered.</div>'; return; }
  state.bills.forEach(b => {
    const item=document.createElement("div"); item.className="list-item";
    const paid=b.status === "Paid";
    item.innerHTML=`<div><strong>${escapeHTML(b.name)} (${paid?"Paid":"Unpaid"})</strong><p>${escapeHTML(b.dueDate)} (${escapeHTML(normalizeFrequency(b.recurring))})</p></div><div class="right"><strong>$${getBillAmountInAUD(b).toFixed(2)} AUD</strong>${b.currency!=="AUD"?`<small>${round2(b.amount)} ${b.currency}</small>`:""}<div>${!paid?`<button class="text-btn success-text" onclick="markBillPaid('${b.id}')">Mark Paid</button>`:""}<button class="text-btn primary-text" onclick="editBill('${b.id}')">Edit</button><button class="text-btn danger-text" onclick="deleteBill('${b.id}')">Remove</button></div></div>`;
    c.appendChild(item);
  });
}
function renderIncomeList() {
  const c=document.getElementById("incomeList"); c.innerHTML="";
  if (!state.incomes.length) { c.innerHTML='<div class="empty-state">No income records.</div>'; return; }
  [...state.incomes].sort((a,b)=>a.date.localeCompare(b.date)).forEach(i => { const item=document.createElement("div"); item.className="list-item"; const label=i.status==="Pending"?"Expected":i.status; item.innerHTML=`<div><strong>${escapeHTML(i.source)} [${label}]</strong><p>${formatDisplayDate(i.date)} | Tax deducted: ${i.taxDeducted}</p></div><div class="right"><strong>$${i.amount.toFixed(2)} AUD</strong><div>${i.status==="Pending"?`<button class="text-btn success-text" onclick="receiveIncome('${i.id}')">Mark Received</button><button class="text-btn primary-text" onclick="editIncome('${i.id}')">Edit</button>`:""}<button class="text-btn danger-text" onclick="deleteIncome('${i.id}')">Delete</button></div></div>`; c.appendChild(item); });
}
function renderTransferHistory() {
  const c=document.getElementById("transferHistory"); c.innerHTML="";
  if (!state.transfers.length) { c.innerHTML='<div class="empty-state">No recorded movements.</div>'; return; }
  state.transfers.forEach(t => { const item=document.createElement("div"); item.className="list-item"; item.innerHTML=`<div><strong>${escapeHTML(t.memo||"")}</strong><p>${escapeHTML(t.date||"")} | ${escapeHTML(t.from||"")} → ${escapeHTML(t.to||"")}</p></div><div class="right"><strong>$${round2(t.amount).toFixed(2)} AUD</strong></div>`; c.appendChild(item); });
}

window.editBill=id=>{ const b=state.bills.find(x=>x.id===id); if(!b)return; for(const [field,val] of [["billName",b.name],["billCurrency",b.currency],["billAmount",b.amount],["billCategory",b.category],["billDueDate",b.dueDate],["billRecurring",normalizeFrequency(b.recurring)]]) document.getElementById(field).value=val; document.getElementById("billForm").dataset.editId=id; document.getElementById("billFormWrap").classList.remove("hidden"); };
window.deleteBill=id=>{ if(confirm("Remove this bill?")){ state.bills=state.bills.filter(b=>b.id!==id); persistState(); } };
window.receiveIncome=id=>{ const i=state.incomes.find(x=>x.id===id); if(i&&i.status==="Pending")initMission(i); };
window.editIncome=id=>{ const i=state.incomes.find(x=>x.id===id); if(!i||i.status!=="Pending")return; document.getElementById("incomeSource").value=i.source; document.getElementById("incomeAmount").value=i.amount; document.getElementById("incomeDate").value=i.date; document.getElementById("taxDeducted").value=i.taxDeducted; document.getElementById("incomeForm").dataset.editId=id; };
window.deleteIncome=id=>{ const i=state.incomes.find(x=>x.id===id); if(!i)return; if(i.status!=="Pending"){ notify("Processed or in-progress income cannot be deleted automatically. Use account reconciliation if needed."); return; } if(confirm("Delete this pending income?")){ state.incomes=state.incomes.filter(x=>x.id!==id); persistState(); } };

document.getElementById("incomeForm")?.addEventListener("submit",e=>{ e.preventDefault(); const form=e.currentTarget, id=form.dataset.editId; const data={source:document.getElementById("incomeSource").value.trim(),amount:round2(document.getElementById("incomeAmount").value),date:document.getElementById("incomeDate").value,taxDeducted:document.getElementById("taxDeducted").value}; if(data.amount<=0)return notify("Enter an income greater than zero."); if(id){const i=state.incomes.find(x=>x.id===id);if(i&&i.status==="Pending")Object.assign(i,data);delete form.dataset.editId;}else state.incomes.push({id:`INC-${Date.now()}`,status:"Pending",...data}); form.reset(); persistState();});
document.getElementById("billForm")?.addEventListener("submit",e=>{ e.preventDefault(); const form=e.currentTarget,id=form.dataset.editId; const data={name:document.getElementById("billName").value.trim(),currency:document.getElementById("billCurrency").value,amount:round2(document.getElementById("billAmount").value),category:document.getElementById("billCategory").value,dueDate:document.getElementById("billDueDate").value,recurring:normalizeFrequency(document.getElementById("billRecurring").value)}; if(data.amount<=0)return notify("Enter a bill amount greater than zero."); if(id){const b=state.bills.find(x=>x.id===id);if(b)Object.assign(b,data);delete form.dataset.editId;}else state.bills.push({id:`BILL-${Date.now()}`,status:"Unpaid",lastPaidDate:null,paidForDueDate:null,...data}); form.reset(); document.getElementById("billFormWrap").classList.add("hidden"); persistState();});
document.getElementById("toggleBillFormBtn")?.addEventListener("click",()=>{const f=document.getElementById("billForm");delete f.dataset.editId;f.reset();document.getElementById("billFormWrap").classList.toggle("hidden");});
document.getElementById("cancelBillEditBtn")?.addEventListener("click",()=>{delete document.getElementById("billForm").dataset.editId;document.getElementById("billFormWrap").classList.add("hidden");});
document.getElementById("mainReconcileForm")?.addEventListener("submit",e=>{e.preventDefault();const target=round2(document.getElementById("actualMainBalance").value);if(target<0)return;executeTransfer("SYSTEM","Main",target,"Manual Main balance reconciliation",{type:"RECONCILIATION"});e.currentTarget.reset();persistState();});
document.getElementById("settingsForm")?.addEventListener("submit",e=>{e.preventDefault();for(const [key,id] of [["mode","mode"],["taxRate","taxRate"],["emergencyTarget","emergencyTarget"],["goldTarget","goldTarget"],["exchangeRate","exchangeRate"],["stabilityEmergencyPct","stabilityEmergencyPct"],["growthEmergencyPct","growthEmergencyPct"],["wealthEmergencyPct","wealthEmergencyPct"]]){const el=document.getElementById(id);if(el)state.policy[key]=el.type==="number"?Number(el.value):el.value;}persistState();notify("Financial policy saved.");});

document.getElementById("exportDataBtn")?.addEventListener("click",()=>{persistState(false);const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`FOS-backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(url);});
document.getElementById("importDataBtn")?.addEventListener("click",()=>document.getElementById("importDataFile").click());
document.getElementById("importDataFile")?.addEventListener("change",e=>{const file=e.target.files?.[0];if(!file)return;const r=new FileReader();r.onload=()=>{try{const imported=migrateState(JSON.parse(r.result));if(!confirm("Replace the current app data with this backup?"))return;state=imported;persistState();populateSettings();notify("Backup imported successfully.");}catch(err){notify("This backup file is not valid.");}};r.readAsText(file);e.target.value="";});
document.getElementById("resetBtn")?.addEventListener("click",()=>{if(confirm("Reset FOS? All balances, bills and income records will be erased.")){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(`${STORAGE_KEY}_backup`);state=clone(DEFAULT_STATE);persistState();populateSettings();}});

function populateSettings(){for(const [id,key] of [["mode","mode"],["taxRate","taxRate"],["emergencyTarget","emergencyTarget"],["goldTarget","goldTarget"],["exchangeRate","exchangeRate"],["stabilityEmergencyPct","stabilityEmergencyPct"],["growthEmergencyPct","growthEmergencyPct"],["wealthEmergencyPct","wealthEmergencyPct"]]){const el=document.getElementById(id);if(el)el.value=state.policy[key];}}

window.addEventListener("load",()=>{loadState();populateSettings();renderAll();});

// Exposed only for automated verification; harmless in production.
window.FOS_TEST_API={getState:()=>clone(state),setState:s=>{state=migrateState(s);persistState(false);},calculateBillsDueBeforePayday,addCycle,markBillPaid:window.markBillPaid,initMission,commitCurrentStep};
