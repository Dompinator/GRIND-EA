import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRIND_BOT_SYSTEM_INSTRUCTION = `You are GRIND-BOT, the exclusive tactical advisor inside the GRIND virtual stock-market game.

STRICT DOMAIN RULE:
- Friendly greetings and casual check-ins ("hi", "hello", "hey", "how are you", "thanks", "what can you do?") are welcome — greet the trader back warmly and invite them to ask about GRIND tactics, net worth, or the current market.
- Help with ANY question about the GRIND game overall: raising net worth, stock & bonding-curve trading tactics, market strategy, portfolio management, coin selection, timing buys/sells, reading price action, Season Battle Pass (Free & PRO 2X tracks), Daily Login streaks, Play (Shorts & Reels where creators earn $0.50 per like), Marketplace Crates & Titles, creating coins, Leaderboards, and account tiers (Member/PRO/Premium).
- If the user asks any question or requests help with ANYTHING unrelated to the GRIND game (such as general homework, coding, real-world investing/crypto/stocks, trivia, math, jokes, recipes, weather, history, health, politics, etc.), you MUST politely refuse and state that GRIND-BOT only helps with the GRIND game and stock tactics.
- SAFETY & AUTO-REPORT RULE: If the user sends anything illegal, dangerous, severely abusive, or bannable (CSAM, self-harm/suicide, violence/weapons/bombs, hacking/cyberattacks/doxxing/account theft, fraud/scams, hate speech, or serious game exploits), refuse immediately and start your response with: [[AUTO_REPORT:Short Category Name]] followed by a brief refusal stating it was reported to Dompinator.
- Always remind users when relevant that GRIND currencies are virtual in-game assets.

GRIND GAME MECHANICS YOU KNOW:
- Starting Cash: $15.00. Daily Login streaks reward cash and Day 7 grants PRO (or +$30 if already PRO/Premium; PRO/Premium get 2X cash on Days 1–6). Play Shorts & Videos let creators earn $0.50 per unique like received on their videos.
- Season Battle Pass: 20 levels unlocked every 5 minutes of Play Time (100m total). Top row is the Free track (cash bonuses, Tier 10 Coin Live Post shoutout, Tier 20 Free PRO upgrade); bottom row is the PRO track giving 2X of every reward (2X cash bonuses, +2 extra Coin Live Posts at Tier 10, and $120 PRO Finale bonus at Tier 20). Season resets reset Pass Play Time only — Leaderboards are untouched.
- Pricing Model (Bonding Curve, CURVE_K = 0.30): Every community coin starts at $1.00 with infinite supply. Buying $X raises price linearly by +0.30 * X and mints ln(newPrice / oldPrice) / 0.30 shares. Selling reverses the exact same curve exponentially (proceeds = (oldPrice - newPrice) / 0.30).
- Net Worth Formula: Net Worth = Available Cash + Total Portfolio Value (including shares held in community coins and your own created coins). You increase Net Worth by capturing bonding-curve inflows (entering before other traders buy), collecting Free/PRO Battle Pass cash, Daily Login streaks, Play video likes ($0.50/like), and launching popular coins.
- Core Strategic Reality of the Curve: You only profit if OTHER traders buy into a coin AFTER your entry. Low-price coins ($1.00-$3.00) have lower dollar resistance per percent gain than expensive coins, whereas high-price coins offer bigger dollar swings if volume keeps flowing.
- Selling Options: Traders can scale out in partial tranches (1/4, 1/2, 3/4, or All) to lock in profit while leaving upside exposure.
- Feeds & Signals: Cheapest (lowest entry curve), Newest (early first-mover entries), Trending (ranked by % today — daily gainers highest, losers lower), Expensive (high-cap leaders), Watchlist (tracked coins), Featured (top 3 spotlighted coins), and LIVE (real-time buys, sells, new launches, and Tier-10 Coin Live Posts).
- Creator Mechanics: Member (max 1 coin), PRO (max 2 coins, Gold Crown, 2X daily rewards, 2X Pass track, unlocks GRIND-BOT), Premium (max 3 coins, Blue Star, 2X daily rewards, 2X Pass track, unlocks GRIND-BOT).

STYLE:
- Be concise, sharp, actionable, and tactical (use clean bullet points or numbered steps when helpful).
- Refer directly to the trader's current market snapshot (cash, net worth, holdings, trending/cheapest coins) when provided.`;

const GRIND_BOT_PREMIUM_SYSTEM_INSTRUCTION = `You are GRIND-BOT Premium, an unrestricted, intelligent AI assistant unlocked exclusively for Premium tier members in the GRIND virtual market game.

PREMIUM UNRESTRICTED ACCESS:
- Because this user has **Premium tier**, you CAN answer **ANY question** on ANY topic — general knowledge, math, science, coding, writing, translations, creative ideas, school/study help, everyday questions, casual chat, AND anything about the GRIND game!
- NEVER refuse a safe non-GRIND topic for a Premium user. Answer helpfully, accurately, and clearly.
- SAFETY & AUTO-REPORT RULE (STILL APPLIES TO PREMIUM): If the user asks for anything illegal, dangerous, severely abusive, or bannable (CSAM, self-harm/suicide, weapons/bombs/violence, hacking/malware/doxxing/account theft, fraud/scams, hate speech, or serious game exploits), refuse immediately and start your response with: [[AUTO_REPORT:Short Category Name]] followed by a brief refusal stating it was reported to Dompinator.
- Whenever the user asks about the GRIND game, Net Worth, coins, Battle Pass, or market tactics, use the live GRIND market data & mechanics below:
  - Starting Cash: $15.00. Daily Login streaks (2X cash Days 1-6 for PRO/Premium, Day 7 PRO or +$30). Play Shorts/Videos pay creators $0.50 per unique like received.
  - Season Battle Pass: 20 levels every 5m Play Time. Top row Free ($5-$60, Lv10 Coin Live Post, Lv20 Free PRO); bottom row PRO 2X ($10-$120, +2 Coin Live Posts at Lv10, $120 Finale at Lv20).
  - Bonding Curve (CURVE_K = 0.30): Start $1.00, +0.30*X price per $X buy, shares = ln(newPrice/oldPrice)/0.30.
  - Feeds: Cheapest, Newest, Trending (ranked by % today — gainers highest, losers lower), Expensive, Watchlist, Featured (top 3 spotlight), and LIVE.
- Refer directly to the trader's live market snapshot when discussing GRIND coins or strategy.`;

function detectServerGrindBotViolation(text: string): string | null {
  const s = String(text || '').toLowerCase();
  if (/\b(child\s*porn|cp\b|csam|underage\s*sex|loli|shota)\b/i.test(s)) return 'Illegal CSAM Content';
  if (/\b(how\s+to\s+(?:kill\s+myself|commit\s+suicide)|suicide\s+methods?|ways\s+to\s+self[\s-]?harm)\b/i.test(s)) return 'Self-Harm / Suicide';
  if (/\b(how\s+to\s+(?:make|build)\s+(?:a\s+)?(?:bomb|explosive|pipe\s*bomb|meth|cocaine|fentanyl|ricin|poison)|how\s+to\s+(?:murder|assassinate|shoot\s+up))\b/i.test(s)) return 'Illegal Weapons / Violence / Drugs';
  if (/\b(how\s+to\s+(?:hack|ddos|dox|phish|steal\s+accounts?|crack\s+passwords?|bypass\s+supabase|sql\s+injection|exploit\s+grind|dupe\s+cash|cheat\s+coins?)|ransomware|keylogger|carding|stolen\s+credit\s+cards?)\b/i.test(s)) return 'Hacking / Exploit / Fraud';
  if (/\b(nigger|nigga|faggot|kike|retard|kys|kill\s+yourself)\b/i.test(s)) return 'Hate Speech / Severe Harassment';
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/giphy', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.get('/api/media/:folder', (req, res) => {
    const rawFolder = String(req.params.folder || '');
    const allowedFolders: Record<string, string> = {
      Music: 'Music',
      music: 'Music',
      ads: 'ads',
    };
    const folderName = allowedFolders[rawFolder];
    if (!folderName) {
      return res.status(404).json({ files: [] });
    }
    try {
      const targetDir = path.join(__dirname, 'public', folderName);
      if (!fs.existsSync(targetDir)) {
        return res.json({ files: [] });
      }
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && !e.name.startsWith('.') && e.name.toLowerCase() !== 'manifest.json')
        .map((e) => e.name);
      return res.json({ files });
    } catch {
      return res.json({ files: [] });
    }
  });

  app.get('/api/giphy', async (req, res) => {
    try {
      const apiKey = (process.env.GIPHY_API_KEY || '').trim();
      if (!apiKey) {
        return res.json({
          configured: false,
          gifs: [],
          error: 'GIPHY_API_KEY is not configured on the server.'
        });
      }

      const rawQ = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? Math.min(30, Math.max(1, Math.round(rawLimit))) : 24;

      const endpoint = rawQ
        ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(rawQ)}&limit=${limit}&rating=pg-13&lang=en`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(apiKey)}&limit=${limit}&rating=pg-13`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let giphyResp: Response;
      try {
        giphyResp = await fetch(endpoint, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      const data = await giphyResp.json().catch(() => null);
      if (!giphyResp.ok || !data || !Array.isArray(data.data)) {
        const msg = data?.meta?.msg || `GIPHY responded with HTTP ${giphyResp.status}`;
        return res.status(502).json({
          configured: true,
          gifs: [],
          error: msg
        });
      }

      const gifs = data.data
        .map((g: any) => {
          const id = String(g?.id || '').trim();
          const title = String(g?.title || 'GIF').trim().slice(0, 100);
          const previewUrl = String(
            g?.images?.fixed_width_small?.url ||
            g?.images?.fixed_width?.url ||
            g?.images?.downsized?.url ||
            ''
          ).trim();
          const gifUrl = String(
            g?.images?.fixed_width?.url ||
            g?.images?.downsized?.url ||
            g?.images?.original?.url ||
            ''
          ).trim();
          const width = Number(g?.images?.fixed_width_small?.width || g?.images?.fixed_width?.width || 200) || 200;
          const height = Number(g?.images?.fixed_width_small?.height || g?.images?.fixed_width?.height || 150) || 150;
          return { id, title, previewUrl, gifUrl, width, height };
        })
        .filter((g: any) => g.id && g.previewUrl && g.gifUrl);

      return res.json({ configured: true, gifs });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'GIPHY proxy error';
      return res.status(500).json({ configured: true, gifs: [], error: msg });
    }
  });

  app.use('/api/grind-bot', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  app.post('/api/grind-bot', async (req, res) => {
    try {
      const { message, history, marketContext, isProOrHigher, isPremium } = req.body || {};
      if (!isProOrHigher && !isPremium) {
        return res.status(403).json({
          error: 'GRIND-BOT requires PRO or Premium tier.'
        });
      }

      const userMessage = typeof message === 'string' ? message.trim() : '';
      if (!userMessage) {
        return res.status(400).json({ error: 'Please enter a message.' });
      }
      if (userMessage.length > 1500) {
        return res.status(400).json({ error: 'Message is too long (max 1500 characters).' });
      }

      const serverFlag = detectServerGrindBotViolation(userMessage);
      if (serverFlag) {
        return res.json({
          flagged: true,
          flagReason: serverFlag,
          reply: `⚠️ This message violates GRIND safety rules (**${serverFlag}**) and has been automatically reported to **Dompinator**.`
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'GRIND-BOT AI service is not configured yet (missing GEMINI_API_KEY).'
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
      if (Array.isArray(history)) {
        for (const turn of history.slice(-12)) {
          if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) continue;
          const role = turn.role === 'model' ? 'model' : 'user';
          contents.push({
            role,
            parts: [{ text: turn.text.slice(0, 1500) }],
          });
        }
      }

      const contextNote =
        typeof marketContext === 'string' && marketContext.trim()
          ? `\n\n[LIVE GRIND MARKET DATA — ALL CURRENT COINS & TRADER PORTFOLIO]\n${marketContext.slice(0, 12000)}`
          : '';

      contents.push({
        role: 'user',
        parts: [{ text: `${userMessage}${contextNote}` }],
      });

      const genPromise = ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction: isPremium ? GRIND_BOT_PREMIUM_SYSTEM_INSTRUCTION : GRIND_BOT_SYSTEM_INSTRUCTION,
        },
      });

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('AI request timed out')), 12000);
      });

      const response = await Promise.race([genPromise, timeoutPromise]);

      let reply = (response.text || '').trim() || 'I could not generate a tactic right now. Ask me about GRIND trading strategy!';
      let flagged = false;
      let flagReason: string | null = null;
      const autoReportMatch = reply.match(/^\[\[AUTO_REPORT:([^\]]+)\]\]\s*/i);
      if (autoReportMatch) {
        flagged = true;
        flagReason = autoReportMatch[1].trim();
        reply = reply.slice(autoReportMatch[0].length).trim()
          || `⚠️ This message violates GRIND safety rules (**${flagReason}**) and has been automatically reported to **Dompinator**.`;
      }
      return res.json({ reply, flagged, flagReason });
    } catch (err: unknown) {
      console.error('GRIND-BOT error:', err);
      const msg = err instanceof Error ? err.message : 'Unexpected GRIND-BOT error.';
      return res.status(500).json({ error: `GRIND-BOT error: ${msg}` });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GRIND server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
