# FOS v1.7.8 — Synchronized Dashboard Engine

This revision makes all visible cards and pages read from one shared forecast snapshot.

## Synchronisation improvements
- Home cards, Bills statuses, Mission allocation, Mission Protection Summary and the 60-day forecast use the same derived calculation results.
- Editing or removing a bill immediately rebuilds an unconfirmed mission recommendation.
- Editing a future paycheck immediately updates the mission, dashboard and bill colours.
- Editing an account balance immediately updates current-cycle funding, Future Bills Fund use and safe-to-spend figures.
- Changing tax, Sadaqah, emergency, gold or exchange-rate policy rebuilds all dependent recommendations.
- The received amount already typed into an active mission is preserved while the rest of the recommendation is refreshed.
- Confirmed missions are never rewritten automatically.
- Saved data from v1.7.7 remains compatible.

## Core rule
Enter or change information once; every relevant FOS screen refreshes from the same state and forecast engine.
