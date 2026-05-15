
# UniSolveX Pilot

Full-stack CRM foundation for marketing automation.

## Local Run

```bash
npm start
```

Open: `http://localhost:3000`

## Free Deploy Setup

Use Firebase Hosting for the frontend and Render free web service for the backend.

### 1. Deploy backend on Render

- Push this repo to GitHub.
- In Render, create a new `Web Service` from the repo.
- Render can auto-detect [render.yaml](/c:/Users/Reya%20Pandiit/OneDrive/Desktop/unisolvex-pilot/render.yaml:1).
- Add these environment variables in Render:
  `FIREBASE_API_KEY`
  `FIREBASE_AUTH_DOMAIN`
  `FIREBASE_PROJECT_ID`
  `FIREBASE_STORAGE_BUCKET`
  `FIREBASE_MESSAGING_SENDER_ID`
  `FIREBASE_APP_ID`
  `FIREBASE_MEASUREMENT_ID`
  `GEMINI_API_KEY`
  `CLOUDINARY_CLOUD_NAME`
  `CLOUDINARY_UPLOAD_PRESET`
  `ADMIN_EMAIL`

### 2. Point frontend to Render backend

- Open [app-config.js](/c:/Users/Reya%20Pandiit/OneDrive/Desktop/unisolvex-pilot/app-config.js:1)
- Replace `http://localhost:3000` with your Render URL

Example:

```js
window.__APP_CONFIG__ = {
  apiBaseUrl: "https://unisolvex-pilot-api.onrender.com",
};
```

### 3. Deploy frontend to Firebase Hosting

```bash
firebase deploy --only hosting
```

## Important Limitation

This backend currently stores data in `data/store.json`. On free Node hosting, filesystem persistence is not reliable, so records can reset after restart or redeploy.

## Modules Included

- Dashboard
- Campaign Manager
- Group / Channel Manager
- Auto Scheduler
- AI Marketing Writer
- Logs & Analytics
- Settings / Firebase config storage
