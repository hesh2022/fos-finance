# FOS — GitHub Pages Ready

Upload every file in this folder to the root of the existing `fos-finance` GitHub repository, replacing the older files. GitHub Pages should remain configured as `main` / `(root)`.

## Important
The app saves data in the current browser using `localStorage`. Use **Policy → Export backup** regularly and before changing devices or clearing browser data.

## Corrected
- Income is credited once only.
- Mission transfers are applied and saved immediately.
- Bills funding uses the deficit after subtracting the current Bills balance.
- Recurring bills remain Paid until their next due date arrives.
- Weekly, fortnightly, monthly, quarterly, six-monthly and yearly cycles are supported.
- Existing `One-time` bills are migrated safely to `One-off`.
- Bills, balances, missions and settings persist locally.
- JSON export/import and reset controls are included.
