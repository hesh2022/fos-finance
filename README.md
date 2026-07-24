# FOS v1.7 — 60-Day Cash-Flow Map

This build separates bills due before the next paycheck from later timing gaps.

Key changes:
- Strict 60-day forecast window
- Chronological use of every expected paycheck entered inside the window
- Blue current-cycle bills, green paycheck-covered cycles, amber Shortfall Reserve, red remaining gaps
- New Shortfall Reserve account
- Mission allocation separates Bills Due Now from Shortfall Reserve
- Existing Shortfall Reserve is released into Bills when protected bills enter the current cycle
- Actual amount received recalculates the full allocation after Change/Enter
