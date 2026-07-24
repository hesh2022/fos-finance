# FOS v1.7.7 — Overdue Priority, Duplicate Protection & Tax Card

This controlled update keeps the verified 60-day forecast logic unchanged and adds three requested improvements.

## Changes
- Adds a Tax account card to the Home dashboard, linked to the same Tax balance used throughout FOS.
- Carries every unpaid overdue bill into the next mission as first-priority current-cycle funding.
- Keeps an overdue bill red until a mission allocates money to it; after allocation it is shown as Protected.
- Detects active duplicate bills with the same name, amount, currency, due date and frequency.
- Warns before saving a duplicate but permits an intentional separate bill after confirmation.
- Removing one duplicate removes only that saved bill record.

## Allocation order
Tax → overdue bills → other bills due before the following paycheck → Future Bills Fund → Sadaqah → Emergency → Gold → Main.

## Compatibility
Existing saved data is preserved. Current overdue bills that the user manually removes are not recreated.
