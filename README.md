<div align="center">

<br/>

```
   ◉  G L I M P S E
```

<br/>

**Your browser just got a brain.**  
Instant AI insights on any page — articles, Reddit threads, docs, products.  
One hotkey. Zero subscriptions. Unlimited.

<br/>

[![Made with Groq](https://img.shields.io/badge/Powered_by-Groq_LPU-5DCAA5?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0iIzFEOUU3NSIvPjwvc3ZnPg==)](https://groq.com)
[![React](https://img.shields.io/badge/React_18-Vite-7F77DD?style=flat-square)](https://vitejs.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-534AB7?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-0F6E56?style=flat-square)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-FAECE7?style=flat-square&logo=googlechrome&logoColor=D85A30)](https://developer.chrome.com/docs/extensions)

<br/>

---

</div>

## What is Glimpse?

Glimpse is a Chrome extension that reads the page you're on and gives you an AI-powered **instant briefing** — without you having to copy-paste anything, switch tabs, or type a prompt.

Open it with **Alt+G**. Get the insight. Keep reading.

It runs on **Groq's free LPU inference** — the fastest AI API on the planet — using your own key. No server costs, no monthly limits, no middleman.

---

## Demo

| Insights tab | Ask tab |
|---|---|
| Extracts key lines, generates a structured breakdown by page type | Full chat with the page as context — no hallucinations |

> *Open any Reddit thread and ask "what's the consensus?" — Glimpse reads every comment and synthesizes it instantly.*

---

## Features

**◉ Smart page detection**  
Glimpse knows if it's reading an article, a Reddit thread, a product page, or docs — and applies a different extraction strategy for each.

**◉ Key Lines**  
The 3 most information-dense sentences on the page, extracted verbatim. Click any one to copy it.

**◉ Structured analysis**  
Not a vague summary. You get: page type → key insight → critical points with names and numbers → caveats. Opinionated. Useful.

**◉ Chat with any page**  
Ask follow-up questions. Glimpse answers from the page only — it'll tell you if something isn't covered rather than making things up.

**◉ Unlimited usage**  
Your Groq key, your quota. Groq's free tier has no monthly cap. We never touch your key — it's stored locally in your browser.

**◉ Fast**  
Groq's LPU inference returns in under a second. No waiting, no spinners, no vibes.

---

## Install (dev build)

```bash
# 1. Clone
git clone https://github.com/MaximuxR93/GlimpseV1.git
cd GlimpseV1/pagepal-extension

# 2. Install deps
npm install

# 3. Build
npm run build
```

Then load it in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

Done. The Glimpse eye icon appears in your browser toolbar (and as a floating button bottom-right on every page).

---

## Get your Groq API key

1. Go to **[console.groq.com/keys](https://console.groq.com/keys)**
2. Sign up (free, no credit card)
3. Create a key — it starts with `gsk_`
4. Paste it into Glimpse on first launch

Your key is stored with `chrome.storage.local` — it never leaves your device.

---

## How it works

```
You open a page
      ↓
content.ts extracts the page text
(smart extraction: semantic selectors → density scoring → fallback cleanup)
      ↓
Alt+G opens the Glimpse sidebar
      ↓
Two parallel Groq calls:
  • llama-3.3-70b → structured analysis (page type + key insight + bullets)
  • llama-3.3-70b → top 3 key lines verbatim
      ↓
You ask a question → full chat with page as context
```

All Groq calls go **directly from your browser to Groq's API** — no backend involved.

---

## Stack

| Layer | Tech |
|---|---|
| Extension runtime | Chrome Manifest V3 |
| UI framework | React 18 + Vite |
| Language | TypeScript (strict) |
| Animations | Framer Motion |
| Shadow DOM isolation | react-shadow |
| AI inference | Groq API — `llama-3.3-70b-versatile` |
| Key storage | `chrome.storage.local` → `localStorage` fallback |

---

## Project structure

```
GlimpseV1/
├── pagepal-extension/
│   ├── src/
│   │   ├── components/
│   │   │   └── Sidebar.tsx       # Main UI — summary, chat, onboarding
│   │   ├── content/
│   │   │   └── index.tsx         # Content script — page extraction + sidebar mount
│   │   └── index.css
│   ├── public/
│   │   └── manifest.json
│   └── vite.config.ts
└── backend/                      # Optional FastAPI dev server (not required)
    └── main.py
```

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt + G` | Toggle Glimpse sidebar |
| `Enter` | Send chat message |
| `Shift + Enter` | New line in chat |

---

## Configuration

No config file needed. Everything is runtime:

- **API key** — entered on first launch, stored locally
- **Model** — `llama-3.3-70b-versatile` (edit `GROQ_MODEL` in `Sidebar.tsx` to change)
- **Context window** — first 12,000 chars of page text sent per request (configurable in `callGroq`)

---

## Security

- Your API key is **never sent to any server we control**
- Groq calls are made directly from your browser
- `.env` files are gitignored — never commit secrets
- Key is cleared automatically if a 401 is returned (invalid key)

---

## Contributing

PRs welcome. A few things on the roadmap:

- [ ] PDF support
- [ ] YouTube transcript extraction
- [ ] Keyboard-navigable key lines
- [ ] Export summary as Markdown
- [ ] Firefox support (MV2 port)

Open an issue first for anything major.

---

## License

MIT — do whatever you want with it.

---

<div align="center">

<br/>

Built with **Groq** inference and too much caffeine.

*If Glimpse saved you 10 minutes today, star the repo. It costs nothing and means a lot.*

⭐

<br/>

</div>
