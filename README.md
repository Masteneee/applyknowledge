# Apply Knowledge

Tell it what you just learned (a school class, a book, an online course, a video series) and it shows you:

- **Where it is used** in real jobs, industries and everyday life
- **Projects** to try, from a one-hour starter to a multi-week stretch
- **What to learn next**, in order, with a search phrase for each step
- **Connections** to things you logged before
- **Careers** that rely on it

Before building the guide, it asks you 3 follow-up questions (your level, what you enjoyed, your time) so the advice fits you. Every guide is saved in a learning journal in your browser, and later guides use the journal to link new knowledge to old.

## Run it

You need [Node.js](https://nodejs.org/) 22 or newer.

```bash
npm install
```

```bash
cp .env.example .env
```

Open `.env` and paste your Claude API key after `ANTHROPIC_API_KEY=`. You can get one at https://platform.claude.com/. Without a key, the site runs in **demo mode** with sample answers, which is enough for working on the design.

```bash
npm start
```

Then open http://localhost:3000.

While you edit code, `npm run dev` restarts the server on every save.

## How it fits together

```
browser (public/)              server (server.js)             Claude API
─────────────────              ──────────────────             ──────────
index.html  the page           checks and trims the input
style.css   the look    ─────► rate limits each visitor ────► ai.js asks Claude and
app.js      the logic   ◄───── returns JSON              ◄──── gets JSON back
            + journal in
            localStorage
```

- **`public/app.js`** runs in the browser. It handles the 3 steps, draws the guide and saves the journal with `localStorage`.
- **`server.js`** serves the page and the two API routes (`/api/questions`, `/api/guide`). It validates input and limits how many requests each visitor can make, because every request costs money.
- **`ai.js`** holds the prompts and talks to Claude. It asks for answers in a fixed JSON shape (a JSON schema), so the browser always gets the same fields.

## Design decisions

- **The API key stays on the server.** The browser never talks to Claude directly, so visitors cannot see or steal the key.
- **No accounts.** The journal lives in each visitor's browser. Use Export / Import to move it between devices. Accounts would need a database and password security, which is a lot for a first version.
- **No invented links.** The AI is told not to produce URLs, since it can make up ones that do not exist. It gives search phrases instead.
- **AI text is inserted with `textContent`, never `innerHTML`.** That way, if the AI output ever contained HTML or a `<script>`, it would show as plain text instead of running.

## Cost

Each guide is 2 calls to Claude. With the default model (`claude-opus-5-5`) that is roughly a few cents per guide. Set `CLAUDE_MODEL=claude-haiku-5-5` in `.env` to make it about 40x cheaper, with somewhat less insightful guidance. The limits in `.env` (`MAX_REQUESTS_PER_IP_PER_HOUR`, `MAX_REQUESTS_PER_DAY`) cap what a public site can spend.

## Ideas for later

- Accounts and a database so the journal syncs across devices
- A visual map of your journal showing how entries connect
- Upload a syllabus PDF instead of typing the topics
- A French interface
