# FOS v1.6 — 60-Day Shortfall Forecast

Deploy the contents of this folder to GitHub Pages or Netlify. Existing local and Supabase data remains compatible.

Important behaviour: starting a mission only opens the proposed allocation. Account balances and bill reservations change only after confirmation.

## Forecast Engine

The forecast now separates two jobs:

1. **Current-cycle bills** — bills due before the next expected paycheck, which the current mission is meant to cover.
2. **Future shortfalls** — bills due from the next paycheck onward that cannot be fully covered by the expected income missions available before their due dates.

The shortfall scan runs for **at least 60 days** and extends farther when necessary to include the **second future paycheck**. The current mission can therefore protect a predicted next-cycle deficit before it becomes urgent. If no future paycheck is entered, FOS asks for one rather than incorrectly labelling current-cycle bills as future shortfalls.
