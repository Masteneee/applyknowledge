// server.js: the web server.
//
// It does three things:
//   1. Serves the files in public/ (the website itself).
//   2. Exposes two API routes the website calls: /api/questions and /api/guide.
//   3. Protects your API bill with simple rate limits, because every call to
//      Claude costs money and the site is public.
//
// The API key never leaves this file's process. The browser only talks to
// this server, never to Claude directly, so visitors cannot steal the key.

import express from "express";
import { askFollowUpQuestions, buildGuide, DEMO_MODE, FriendlyError } from "./ai.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PER_IP_PER_HOUR = Number(process.env.MAX_REQUESTS_PER_IP_PER_HOUR) || 20;
const PER_DAY = Number(process.env.MAX_REQUESTS_PER_DAY) || 500;

app.use(express.json({ limit: "50kb" })); // reject huge payloads early
app.use(express.static("public"));

// ---------- Rate limiting ----------
// Kept in memory: simple, and resets when the server restarts. Good enough
// for a first version; a bigger site would use a database such as Redis.

const hitsByIp = new Map(); // ip -> list of timestamps (ms)
let dailyCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;

function rateLimit(req, res, next) {
  const now = Date.now();

  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  if (dailyCount >= PER_DAY) {
    return res.status(429).json({ error: "The site reached its daily limit. Come back tomorrow." });
  }

  const oneHourAgo = now - 60 * 60 * 1000;
  const recent = (hitsByIp.get(req.ip) || []).filter((t) => t > oneHourAgo);
  if (recent.length >= PER_IP_PER_HOUR) {
    return res.status(429).json({ error: "You have made a lot of requests. Wait a bit and try again." });
  }

  recent.push(now);
  hitsByIp.set(req.ip, recent);
  dailyCount++;
  next();
}

// ---------- Input checking ----------
// Never trust what the browser sends. Trim strings and cap their length.

const KINDS = ["school course", "book", "online course", "video or podcast", "other"];

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanEntry(raw = {}) {
  const entry = {
    title: text(raw.title, 150),
    kind: KINDS.includes(raw.kind) ? raw.kind : "other",
    topics: text(raw.topics, 2000),
    goal: text(raw.goal, 300),
  };
  if (!entry.title || !entry.topics) {
    throw new FriendlyError("Please fill in the title and what it covered.");
  }
  return entry;
}

function cleanJournal(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-30).map((j) => ({
    title: text(j?.title, 150),
    kind: KINDS.includes(j?.kind) ? j.kind : "other",
    topics: text(j?.topics, 300),
  }));
}

function cleanAnswers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((a) => ({
    question: text(a?.question, 300),
    answer: text(a?.answer, 600),
  }));
}

// ---------- Routes ----------

app.get("/api/status", (req, res) => {
  res.json({ demo: DEMO_MODE });
});

app.post("/api/questions", rateLimit, async (req, res) => {
  try {
    const entry = cleanEntry(req.body.entry);
    const journal = cleanJournal(req.body.journal);
    res.json(await askFollowUpQuestions(entry, journal));
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/guide", rateLimit, async (req, res) => {
  try {
    const entry = cleanEntry(req.body.entry);
    const answers = cleanAnswers(req.body.answers);
    const journal = cleanJournal(req.body.journal);
    res.json(await buildGuide(entry, answers, journal));
  } catch (error) {
    sendError(res, error);
  }
});

function sendError(res, error) {
  if (error instanceof FriendlyError) {
    return res.status(400).json({ error: error.message });
  }
  console.error(error); // full details stay in the server log, not the browser
  res.status(500).json({ error: "Something unexpected went wrong. Try again." });
}

app.listen(PORT, () => {
  console.log(`Apply Knowledge running at http://localhost:${PORT}`);
  if (DEMO_MODE) console.log("No ANTHROPIC_API_KEY found: running in demo mode with sample answers.");
});
