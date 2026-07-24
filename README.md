# FOS v1.7.1 — Verified Cash-Flow Map

This build uses one calculation source for the dashboard, mission allocation and 60-day forecast.

Key changes:
- Strict 60-day forecast from the mission date
- Bills beyond 60 days are excluded
- Bills due before the next paycheck are current-cycle bills, not future shortfalls
- Every later paycheck inside the window is applied chronologically and only after its arrival date
- The dashboard, mission bill list and Bills Due Now allocation use the same current-cycle total
- Shortfall Reserve contains only genuine timing gaps left after eligible later paychecks
- Actual amount received recalculates tax and the complete allocation after Change/Enter
- Unconfirmed missions from earlier builds are rebuilt automatically using the corrected engine
- Allocation summary separates protected-account allocations from the amount remaining in Main
- Blue = due now, green = covered by later paychecks, amber = Shortfall Reserve, red = still unfunded

Verification performed:
- Current-cycle bill total matches mission selection
- 30 July and 30 August paychecks are both detected inside the window
- A bill 16 months later is excluded
- A timing gap is calculated chronologically
- Tax recalculates from AUD 17,000 received to AUD 4,250 at 25%
- Suggested allocation balances exactly to the received amount
