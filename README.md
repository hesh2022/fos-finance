# FOS v1.7.4 — Mission Summary Review Fix

This build corrects the mission review presentation and a JavaScript rendering defect.

## Changes
- Shows Current bills funded now.
- Shows Added to Future Bills Fund.
- Shows Future gap still unfunded.
- Keeps the current-cycle bill list and its gross selected total separate.
- Recalculates the three summary figures whenever an allocation field or bill selection changes.
- Fixes an undefined `selectedGross` variable that could interrupt mission-page rendering.

## Verification scenario
For AUD 17,000 received, AUD 4,250 tax, AUD 2,000 current bills, AUD 10,750 Future Bills Fund, and a forecast gap of AUD 14,577.69:
- Total allocated: AUD 17,000
- Remaining to Main: AUD 0
- Future gap still unfunded: AUD 3,827.69
