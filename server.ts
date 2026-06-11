import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// High limit for base64 camera image uploads
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ limit: '12mb', extended: true }));

// Set up Gemini if available
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
} else {
  console.warn('GEMINI_API_KEY is not defined in environment secrets. AI scanning will return Mock estimates.');
}

// Helper to call Gemini models with retry and graceful fallback
async function generateContentWithRetryAndFallback(ai: any, contents: any[], customConfig: any, models: string[]) {
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[AI SCAN] Attempting scanning with model ${model} (attempt ${attempt}/2)`);
        const response = await ai.models.generateContent({
          model: model,
          contents: contents,
          config: customConfig
        });

        if (response && response.text) {
          console.log(`[AI SCAN] Successfully processed scan with model: ${model}`);
          return response;
        }

        throw new Error(`Model ${model} returned an empty response.`);
      } catch (err: any) {
        lastError = err;
        const errMsg = err.message || JSON.stringify(err);
        console.warn(`[AI SCAN] Model ${model} attempt ${attempt} failed: ${errMsg}`);

        // Robust detection of client-side or credential errors (400, 403, etc.)
        let isClientError = false;
        try {
          const status = err.status || err.code;
          if (status === 400 || status === 403) {
            isClientError = true;
          } else if (errMsg) {
            // Check if the error message contains 400 or 403 indicators (e.g. bad API key or wrong parameters)
            if (errMsg.includes('"code": 400') || errMsg.includes('"code": 403') || errMsg.includes('code: 400') || errMsg.includes('code: 403')) {
              isClientError = true;
            }
          }
        } catch (_) {}

        if (isClientError) {
          console.warn(`[AI SCAN] Client or configuration error (400/403), skipping subsequent model attempts.`);
          break;
        }

        // Delay slightly before retrying the same model
        if (attempt < 2) {
          const delay = attempt * 1200;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  throw lastError || new Error('All scanning models failed to respond.');
}

// Dominoes scanning proxy route
app.post('/api/scan-dominoes', async (req, res) => {
  try {
    const { image, mimeType, mode } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'لم يتم استلام أي صورة للكاميرا.' });
    }

    // Two scan modes:
    //  - 'fast'    → lead with the lightweight flash-lite model (quicker, less precise)
    //  - 'accurate'→ lead with the stronger model (default; slower but better counting)
    const models = mode === 'fast'
      ? ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.5-flash']
      : ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];

    if (!ai) {
      // Return a graceful simulated response if API key is not configured yet
      console.warn('AI Scanner called, but GEMINI_API_KEY is absent. Simulating detection.');
      // Random mock detection for local test
      const l = Math.floor(Math.random() * 7);
      const r = Math.floor(Math.random() * 7);
      return res.json({
        tiles: [{ left: l, right: r, total: l + r }],
        totalScore: l + r,
        explanation: `(محاكاة) تم الكشف عن قطعة دومينو: [${l}|${r}]`
      });
    }

    const contents = [
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: image
        }
      },
      {
        text: `Count the pips on EVERY domino tile in this photo.

Work through it carefully, one tile at a time:
1. Find each separate domino piece. Tiles can be horizontal or vertical; the dividing line splits each tile into two halves.
2. For each half, count the dots precisely (0 to 6). A half can legitimately be blank (0).
3. tile total = left half + right half.
4. The hand total = the sum of every tile total.

Important:
- Do NOT guess. If part of a tile is hidden behind a finger or another tile, or is blurry, count only what is clearly visible and lower the confidence for that tile.
- Re-count each half a second time before finalizing to avoid mistakes (e.g. 5 vs 6).
- Return JSON matching the schema. If no domino is visible, return an empty tiles list and totalScore 0.`
      }
    ];

    const config = {
      systemInstruction: `You are an expert AI Domino Companion Scanner. Your job is to strictly examine images containing a user's full hand of dominoes. Detect every single distinct piece, count the points (pips) on both halves of each piece, calculate the total points, and present the output in structured JSON format. Double-check your dots calculations to ensure perfect accuracy. Never guess at hidden or blurry pips — count only what is clearly visible and report low confidence instead.`,
      // Deterministic counting: no creative sampling for a precise vision task.
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tiles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                left: { type: Type.INTEGER, description: 'Dots count on one side of the domino line (0-6)' },
                right: { type: Type.INTEGER, description: 'Dots count on the other side (0-6)' },
                total: { type: Type.INTEGER, description: 'Total points of this tile' },
                confidence: { type: Type.NUMBER, description: 'Confidence 0..1 that this tile was counted correctly; lower it when pips are hidden or blurry' }
              },
              required: ['left', 'right', 'total']
            }
          },
          totalScore: { type: Type.INTEGER, description: 'Combined points sum of all identified tiles in the player hand' },
          explanation: { type: Type.STRING, description: 'Brief description of the full hand of tiles detected, written in clear Arabic' }
        },
        required: ['tiles', 'totalScore', 'explanation']
      }
    };

    // Call server-side Gemini Model with retry and fallback
    const response = await generateContentWithRetryAndFallback(ai, contents, config, models);

    const text = response.text;
    if (!text) {
      throw new Error('Empty result from Gemini.');
    }

    const payload = JSON.parse(text);
    return res.json(payload);
  } catch (err: any) {
    console.error('Gemini Domino scan error:', err);
    return res.status(500).json({ error: err.message || 'حدث خطأ أثناء فحص قطع الدومينو بواسطة الذكاء الاصطناعي.' });
  }
});

// Serve frontend routes
const isProd = process.env.NODE_ENV === 'production';
if (!isProd) {
  const { createServer: createViteServer } = await import('vite');
  const viteServer = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });
  app.use(viteServer.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Tarabish app online on port ${port}`);
});
