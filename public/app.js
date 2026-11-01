// app.js: everything that happens in the browser.
//
// The flow has three steps:
//   1. The visitor describes what they learned.
//   2. We ask the server for follow-up questions, and they answer.
//   3. We ask the server for the guide, show it, and save it to the journal.
//
// Safety note: the guide text comes from an AI that read the visitor's input,
// so we always insert it with textContent, never innerHTML. That way text like
// "<script>" is displayed as text instead of being run as code (an XSS attack).

const STORAGE_KEY = "applyknowledge.journal.v1";

// ---------- Small helpers ----------

const $ = (id) => document.getElementById(id);

// Create an element with an optional class and text in one line.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function show(stepId) {
  for (const id of ["step-entry", "step-questions", "step-loading", "step-guide"]) {
    $(id).hidden = id !== stepId;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

// Send JSON to our server and get JSON back. Throws with the server's message.
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

// ---------- Journal (saved in this browser with localStorage) ----------
// localStorage can be blocked (private windows, strict settings), so every
// read and write is wrapped in try/catch and the site keeps working anyway.

function loadJournal() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveJournal(journal) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
  } catch {
    // Storage full or blocked: the guide is still shown, just not remembered.
  }
}

// What we send to the server about past entries: just enough for context.
function journalForServer(excludeId) {
  return loadJournal()
    .filter((item) => item.id !== excludeId)
    .map((item) => ({ title: item.entry.title, kind: item.entry.kind, topics: item.entry.topics }));
}

function renderJournal() {
  const journal = loadJournal();
  const list = $("journal-list");
  list.replaceChildren();
  $("journal-empty").hidden = journal.length > 0;

  // Newest first.
  for (const item of [...journal].reverse()) {
    const li = el("li");

    const open = el("button", "journal-open");
    open.type = "button";
    open.append(el("strong", "", item.entry.title));
    const date = new Date(item.createdAt).toLocaleDateString();
    open.append(el("span", "", `${item.entry.kind} · ${date}`));
    open.addEventListener("click", () => showGuide(item));

    const del = el("button", "journal-delete", "×");
    del.type = "button";
    del.setAttribute("aria-label", `Delete ${item.entry.title}`);
    del.addEventListener("click", () => {
      if (!confirm(`Delete "${item.entry.title}" from your journal?`)) return;
      saveJournal(loadJournal().filter((j) => j.id !== item.id));
      renderJournal();
    });

    li.append(open, del);
    list.append(li);
  }
}

// ---------- Step 1: the entry form ----------

let current = null; // { entry, questions } for the entry being built

$("entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const entry = {
    title: form.get("title").trim(),
    kind: form.get("kind"),
    topics: form.get("topics").trim(),
    goal: form.get("goal").trim(),
  };

  if (!entry.title || !entry.topics) {
    showError("entry-error", "Please fill in the title and what it covered.");
    return;
  }
  showError("entry-error", "");

  $("loading-text").textContent = "Reading what you learned…";
  show("step-loading");
  try {
    const data = await post("/api/questions", { entry, journal: journalForServer() });
    current = { entry, questions: data.questions };
    renderQuestions(data.questions);
    show("step-questions");
  } catch (error) {
    show("step-entry");
    showError("entry-error", error.message);
  }
});

// ---------- Step 2: follow-up questions ----------

function renderQuestions(questions) {
  const list = $("questions-list");
  list.replaceChildren();
  questions.forEach((q, i) => {
    const wrap = el("div", "question");
    const label = el("label", "", q.question);
    label.htmlFor = `answer-${i}`;
    const why = el("p", "why", q.why);
    const input = el("textarea");
    input.id = `answer-${i}`;
    input.rows = 2;
    input.maxLength = 600;
    wrap.append(label, why, input);
    list.append(wrap);
  });
}

$("back-btn").addEventListener("click", () => show("step-entry"));

$("questions-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answers = current.questions.map((q, i) => ({
    question: q.question,
    answer: $(`answer-${i}`).value.trim(),
  }));

  $("loading-text").textContent = "Building your guide. This can take up to a minute…";
  show("step-loading");
  try {
    const guide = await post("/api/guide", {
      entry: current.entry,
      answers,
      journal: journalForServer(),
    });

    const item = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      entry: current.entry,
      answers,
      guide,
    };
    const journal = loadJournal();
    journal.push(item);
    saveJournal(journal);
    renderJournal();

    $("entry-form").reset();
    showGuide(item);
  } catch (error) {
    show("step-questions");
    showError("questions-error", error.message);
  }
});

// ---------- Step 3: show a guide ----------

function section(title, intro) {
  const card = el("section", "card");
  card.append(el("h2", "", title));
  if (intro) card.append(el("p", "section-intro", intro));
  return card;
}

function showGuide(item) {
  const { entry } = item;
  // Defaults protect against older or hand-edited imported journals.
  const guide = { applications: [], projects: [], nextSteps: [], connections: [], careers: [], ...item.guide };
  $("guide-label").textContent = `Your guide · ${entry.kind}`;
  $("guide-title").textContent = entry.title;
  $("guide-summary").textContent = guide.summary;

  const sections = $("guide-sections");
  sections.replaceChildren();

  // Where it is used
  const apps = section("Where this is used", "Real places this knowledge shows up.");
  const appGrid = el("div", "grid");
  for (const a of guide.applications) {
    const card = el("div", "item");
    card.append(el("p", "meta", a.where), el("h3", "", a.title), el("p", "", a.how));
    appGrid.append(card);
  }
  apps.append(appGrid);
  sections.append(apps);

  // Projects
  const projects = section("Try it yourself", "Projects that make the knowledge stick, from easy to ambitious.");
  const projGrid = el("div", "grid");
  for (const p of guide.projects) {
    const card = el("div", "item");
    const meta = el("p", "meta");
    meta.append(el("span", `tag ${p.difficulty}`, p.difficulty), document.createTextNode(p.time));
    card.append(meta, el("h3", "", p.title), el("p", "", p.description));
    projGrid.append(card);
  }
  projects.append(projGrid);
  sections.append(projects);

  // Next steps
  const next = section("What to learn next", "In the order that builds best on what you know.");
  const path = el("ol", "path");
  for (const step of guide.nextSteps) {
    const li = el("li");
    const link = el("a", "search-link", `Search: “${step.searchFor}”`);
    link.href = `https://www.google.com/search?q=${encodeURIComponent(step.searchFor)}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    li.append(el("h3", "", step.topic), el("p", "", step.why), link);
    path.append(li);
  }
  next.append(path);
  sections.append(next);

  // Connections with the journal (only if there are any)
  if (guide.connections.length) {
    const conn = section("Connections to what you already know", "How this links to earlier entries in your journal.");
    const grid = el("div", "grid");
    for (const c of guide.connections) {
      const card = el("div", "item");
      card.append(el("p", "meta", `With: ${c.entry}`), el("p", "", c.insight));
      grid.append(card);
    }
    conn.append(grid);
    sections.append(conn);
  }

  // Careers
  const careers = section("Careers that rely on this");
  const careerGrid = el("div", "grid");
  for (const c of guide.careers) {
    const card = el("div", "item");
    card.append(el("h3", "", c.name), el("p", "", c.howItUsesThis));
    careerGrid.append(card);
  }
  careers.append(careerGrid);
  sections.append(careers);

  show("step-guide");
}

$("new-btn").addEventListener("click", () => {
  showError("entry-error", "");
  showError("questions-error", "");
  show("step-entry");
});

// ---------- Export / import the journal as a file ----------

$("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(loadJournal(), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "learning-journal.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

$("import-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) throw new Error();
    // Keep only well-formed items, and skip ones we already have.
    const journal = loadJournal();
    const known = new Set(journal.map((j) => j.id));
    for (const item of imported) {
      if (item?.id && item.entry?.title && item.guide?.summary && !known.has(item.id)) {
        journal.push(item);
      }
    }
    saveJournal(journal);
    renderJournal();
  } catch {
    alert("That file is not a valid learning journal export.");
  }
  event.target.value = "";
});

// ---------- Start ----------

renderJournal();
fetch("/api/status")
  .then((r) => r.json())
  .then((s) => { $("demo-badge").hidden = !s.demo; })
  .catch(() => {});
