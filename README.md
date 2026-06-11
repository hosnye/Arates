# لعبة طرابيش — Tarabish Domino Tracker & AI Scanner

A multi-device dominoes scoring companion with a "controller" lock (one phone edits,
the rest watch live), live sync over Supabase, and an AI camera scanner that counts
the pips on a hand of tiles and suggests the score to whoever holds the controller.

## Project layout

- `public/index.html` … `public/index.js` — the actual app (vanilla JS, Supabase live-sync).
  These are served as static files at the site root.
- `server.ts` — tiny Express server. Serves the app and proxies `/api/scan-dominoes`
  to Google Gemini so the API key stays on the server, never in the browser.
- `Dockerfile` / `render.yaml` — production build + free hosting on Render.

## Run locally

**Prerequisites:** Node.js 20+

1. Install dependencies: `npm install`
2. (Optional) create `.env` with `GEMINI_API_KEY=...` — without it the scanner returns
   mock estimates so the rest of the app still works.
3. Start dev: `npm run dev` → http://localhost:3000

## Deploy free on Render

1. Push this repo to GitHub.
2. On https://render.com → **New + → Blueprint** → select this repo. Render reads
   `render.yaml` and creates a free Docker web service.
3. In the service's **Environment** tab, add `GEMINI_API_KEY` with your real key.
4. Open the generated `*.onrender.com` URL on every player's phone.

Notes:
- The free plan sleeps after ~15 min idle; the first request afterwards takes ~30s to
  wake up, then it's instant again.
- Supabase keys in `public/index.js` are the public/anon keys (safe to ship). The
  Gemini key is the only secret and lives only on the server.

## How the controller + scan flow works

- One phone taps **🔓 دخول التحكم** and enters the code to become the controller.
  Only the controller can change scores; everyone else is in live view mode.
- Any player can open the **📷 camera**, scan their tiles, and tap **إبلّغ المتحكم**.
  The suggested total is broadcast directly to the controller (it does **not** touch
  the shared scoreboard), who sees a banner and taps **➕ ضيف** to apply it in one tap.
