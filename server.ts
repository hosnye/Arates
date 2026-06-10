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
async function generateContentWithRetryAndFallback(ai: any, contents: any[], customConfig: any) {
  // Use gemini-3.1-flash-lite as the absolute first choice because of its high availability and speed
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
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
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'لم يتم استلام أي صورة للكاميرا.' });
    }

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
        text: `Evaluate the set of domino tiles representing a complete player's hand in this photo.
Identify ALL domino tiles present in the hand clearly. Do not inspect just one; find and count EVERY single piece shown in the image.
For each separate domino piece, count the number of pips (dots) on both of its halves (left and right sections, or top and bottom sections).
Sum up all values from all the detected tiles in the hand to find the combined total score of the hand.
Provide your response in JSON matching the schema. If no domino is found, return an empty tiles list and totalScore 0.`
      }
    ];

    const config = {
      systemInstruction: `You are an expert AI Domino Companion Scanner. Your job is to strictly examine images containing a user's full hand of dominoes. Detect every single distinct piece, count the points (pips) on both halves of each piece, calculate the total points, and present the output in structured JSON format. Double-check your dots calculations to ensure perfect accuracy.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tiles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                left: { type: Type.INTEGER, description: 'Dots count on one side of the domino line' },
                right: { type: Type.INTEGER, description: 'Dots count on the other side' },
                total: { type: Type.INTEGER, description: 'Total points of this tile' }
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
    const response = await generateContentWithRetryAndFallback(ai, contents, config);

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
