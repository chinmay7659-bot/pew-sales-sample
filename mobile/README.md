# Sample Stock Log — Expo Mobile App

React Native + Expo mobile app for tracking sample inventory, trays, and balances across salespeople, synced live with **Google Sheets** (works completely outside AI Studio).

## Project Structure

- `App.tsx` — Bottom-tab navigation (`Sample Records`, `Log Sample`, `Manage Lists`, `Sheet Sync`), foreground auto-sync (every 12s), and offline-first `AsyncStorage` caching
- `src/screens/RecordsScreen.tsx` — Summary KPIs, search, salesperson filter, per-salesperson held balances, pull-to-refresh, inline History editing/deletion, and native CSV share export
- `src/screens/NewRecordScreen.tsx` — 4-step touch entry form with bottom-sheet pickers, date modal, quantity/tray steppers, and balance checks
- `src/screens/ManageListsScreen.tsx` — Full add, inline edit (cascading across models & records), import from records, and protected delete for Salespeople, Designs, and Model Numbers
- `src/screens/SyncScreen.tsx` — Google Sheet Sync URL connection (with built-in 4-step Apps Script setup & shareable `Code.gs` template), optional Google Sign-In OAuth, and `Your Name` record tagging
- `src/services/googleSheetsClient.ts` — Google Sheets REST v4 OAuth client + Apps Script Web App bridge client (`Samples`, `Salespeople`, `Designs`, `Models` tabs)
- `src/services/appsScriptTemplate.ts` — Copy-ready Google Apps Script (`Code.gs`) template using `LockService` and `getDisplayValues()`
- `src/storage/` — `localStore.ts` (`AsyncStorage` data cache) and `syncSettings.ts` (`bridgeUrl`, `spreadsheetId`, `memberName`)

## Syncing Mobile & Web with Google Sheets (Outside AI Studio)

### Option A: Google Sheet Sync URL (Recommended — zero GCP/SHA-1 setup)
1. Create or open a Google Sheet (`sheets.new`).
2. Open **Extensions → Apps Script**, paste the template shown in the app's **Sheet Sync** tab (`src/services/appsScriptTemplate.ts`), and save.
3. Click **Deploy → New deployment → Web app**, set **Execute as: Me** and **Who has access: Anyone**, then copy the `.../exec` Web App URL.
4. Paste that URL in the mobile **Sheet Sync** tab (or pre-bake it via `EXPO_PUBLIC_SHEETS_BRIDGE_URL` in `.env` / GitHub Repository Variables before building the `.apk`). Both the mobile `.apk` and the web app can use the exact same URL!

### Option B: Direct Google Sign-In OAuth (Optional)
Configure `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` (with your Android keystore SHA-1 in Google Cloud Console), `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and/or `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `mobile/.env` before building.

## Getting a Standalone Android `.apk`

1. Push this repo to GitHub and trigger the **Build Direct Android APK** workflow (`.github/workflows/android-apk.yml`) under **Actions** (or run `npm run build:preview:android` with Expo EAS).
2. Download the `pew-sales-sample.apk` artifact on your Android phone and install it.

## Run Locally (Expo Go / Simulators)

```bash
cd mobile
npm install
npx expo start
```
