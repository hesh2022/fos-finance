# FOS v1.3 — Review & Allocate

Deploy the contents of this folder to GitHub Pages. Existing local and Supabase data is migrated to schema version 5.

Important behaviour: starting a mission only opens the proposed allocation. Account balances and bill reservations change only after confirmation.


## Forecast Engine

The allocation screen now scans all known future missions and bills. If a later mission cannot fully cover a bill due after it, FOS recommends protecting that bill from the current mission. The dashboard also calculates a Suggested Hold in Main for future bills that expected missions cannot cover.
