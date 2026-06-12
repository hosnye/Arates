# لعبة طرابيش — Tarabish Domino Tracker & AI Scanner

A multi-device dominoes scoring companion with a "controller" lock (one phone edits,
the rest watch live), live sync over Supabase, and an **on-device** camera scanner that
counts the pips on a hand of tiles in real time and suggests the score to whoever holds
the controller. Scanning runs entirely in the browser via a trained YOLO11n model
(`public/models/domino.onnx`) — no server-side AI, no API keys, works offline.

## Project layout

- `public/index.html` … `public/index.js` — the actual app (vanilla JS, Supabase live-sync).
  These are served as static files at the site root.
- `public/domino-detector.js` / `public/models/domino.onnx` — the on-device pip detector
  (onnxruntime-web) and the trained model. See `ml/` for how the model is built/trained.
- `server.ts` — tiny Express server. Serves the app and a `/api/warmup` keep-alive ping.
- `Dockerfile` / `render.yaml` — production build + free hosting on Render.

## Run locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. Start dev: `npm run dev` → http://localhost:3000

No secrets or `.env` are required — the scanner is fully on-device.

## Deploy free on Render

1. Push this repo to GitHub.
2. On https://render.com → **New + → Blueprint** → select this repo. Render reads
   `render.yaml` and creates a free Docker web service (no env vars needed).
3. Open the generated `*.onrender.com` URL on every player's phone.

Notes:
- The free plan sleeps after ~15 min idle; the first request afterwards takes ~30s to
  wake up, then it's instant again. The app pings `/api/warmup` on load so the server is
  usually awake before anyone loads the page or the model. For a server that's *always*
  warm, point a free uptime pinger (e.g. cron-job.org or UptimeRobot) at
  `https://<your-app>.onrender.com/api/warmup` every ~10 minutes.
- Supabase keys in `public/index.js` are the public/anon keys (safe to ship). There are
  no other secrets — nothing server-side to configure.

## How the controller + scan flow works

- One phone taps **🔓 دخول التحكم** and enters the code to become the controller.
  Only the controller can change scores; everyone else is in live view mode.
- Any player can open the **📷 camera**, scan their tiles, and tap **إبلّغ المتحكم**.
  The suggested total is broadcast directly to the controller (it does **not** touch
  the shared scoreboard), who sees a banner and taps **➕ ضيف** to apply it in one tap.
