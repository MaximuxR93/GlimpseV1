<div align="center">

<br/>

```
   ◉  G L I M P S E
```

### Your browser just got a brain.

Instant AI insights on any page — articles, Reddit threads, docs, products.<br/>
One hotkey. Zero subscriptions. Unlimited. Works with **Groq, OpenAI, Anthropic & OpenRouter.**

<br/>

[![Groq](https://img.shields.io/badge/Groq-LPU_Inference-5DCAA5?style=flat-square)](https://groq.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-Compatible-74aa9c?style=flat-square)](https://openai.com)
[![Anthropic](https://img.shields.io/badge/Anthropic-Compatible-c97d4e?style=flat-square)](https://anthropic.com)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-Compatible-7F77DD?style=flat-square)](https://openrouter.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-534AB7?style=flat-square)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-0F6E56?style=flat-square)](LICENSE)

<br/>

---

</div>

## What is Glimpse?

Glimpse is a Chrome extension that reads the page you're on and gives you an AI-powered **instant briefing** — without copy-pasting anything, switching tabs, or typing a prompt.

It slides in as a sidebar overlay on any page. Press **Alt+G**, get the insight, keep reading.

Bring your own API key from any provider. No backend. No subscriptions. No limits.

---

## Screenshots

<div align="center">

**Live on NASA's Black Holes page — sidebar generated in 1.1s**

<img src="assets/ACEEB552-B88E-4C25-869B-D97F59FB8E74.png" width="100%" />

<br/><br/>

<table>
  <tr>
    <td align="center" width="50%">
      <img src="pagepal-extension/src/assets/4DF24A53-1B0B-484E-BFB1-0B20C6D0D576.png" width="260" /><br/>
      <sub><b>Summary tab</b> — TL;DR, key insights, data points & caveats</sub>
    </td>
    <td align="center" width="50%">
      <img src="pagepal-extension/src/assets/71952EBF-2BA7-4B85-AFDF-57913E16DA23.png" width="260" /><br/>
      <sub><b>Chat tab</b> — ask anything, grounded strictly in the page</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="pagepal-extension/src/assets/77BEEA62-AA1E-4A78-816F-0969AD41BDBC.png" width="260" /><br/>
      <sub><b>Highlight & Ask</b> — select text, get instant context</sub>
    </td>
    <td align="center" width="50%">
      <img src="pagepal-extension/src/assets/9A4F2C2F-C3E3-48E2-BA1B-A65B93AE5008.png" width="260" /><br/>
      <sub><b>Model Settings</b> — switch provider & model on the fly</sub>
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="pagepal-extension/src/assets/4FED5E27-2153-4ED8-AAD8-3197F82798A4.png" width="260" /><br/>
      <sub><b>Recent Analyses</b> — locally stored reading history</sub>
    </td>
  </tr>
</table>

</div>

---

## Features

**◉ Instant page briefing**  
Open the sidebar and Glimpse immediately generates a structured breakdown: TL;DR → Key Insights → Data points → Caveats. Not a vague summary — actual signal with numbers and names.

**◉ Chat with any page**  
Ask anything in the Chat tab. Glimpse answers using only the page content — it won't hallucinate. If something isn't covered, it says so.

**◉ Highlight & Ask**  
Select any text on the page. Glimpse pops up with one-click actions: *Explain simply*, *Why does this matter?*, *Fact-check this*, *What's the context?*, *Simplify for a beginner* — or type your own question.

**◉ Recent Analyses**  
Every page you've analysed is saved locally with a timestamp. Jump back to any previous summary without re-running.

**◉ Multi-provider support**  
Choose your AI provider and model from the settings panel:
- **Groq** — fastest inference, free tier, no monthly cap
- **OpenAI** — GPT-4o and friends
- **Anthropic** — Claude models
- **OpenRouter** — access any model through one key

**◉ Your key, your device**  
API keys are stored with `chrome.storage.local` — never sent to any server we control. The settings panel links directly to free keys for every provider.

**◉ Page stats**  
Word count, estimated read time, compression ratio, and generation time shown on every analysis.

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

Load in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

The Glimpse eye icon appears in your toolbar and as a floating button on every page.

---

## Get an API key

| Provider | Free tier | Link |
|---|---|---|
| Groq | ✅ No monthly cap | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenAI | Limited free credits | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | Limited free credits | [console.anthropic.com](https://console.anthropic.com) |
| OpenRouter | Free models available | [openrouter.ai/keys](https://openrouter.ai/keys) |

On first launch, Glimpse walks you through setup. Keys are stored locally — never shared.

---

## How it works

```
You open a page
      ↓
content.ts extracts page text
(semantic selectors → density scoring → Reddit special case → fallback)
      ↓
Alt+G opens the Glimpse sidebar
      ↓
AI call → structured analysis
  TL;DR · Key Insights · Data · Caveats · Follow-up suggestions
      ↓
Chat tab        → full Q&A grounded in page content
Highlight & Ask → instant context on any selected text
Recent Analyses → local history of every page you've glimpsed
```

All AI calls go **directly from your browser to your chosen provider** — no backend required.

---

## Stack

| Layer | Tech |
|---|---|
| Extension runtime | Chrome Manifest V3 |
| UI framework | React 18 + Vite |
| Language | TypeScript (strict) |
| Animations | Framer Motion |
| Shadow DOM isolation | react-shadow |
| AI providers | Groq · OpenAI · Anthropic · OpenRouter |
| Key storage | `chrome.storage.local` + `localStorage` fallback |

---

## Project structure

```
GlimpseV1/
├── pagepal-extension/
│   ├── src/
│   │   ├── components/
│   │   │   └── Sidebar.tsx       # Main UI — summary, chat, highlight, history, settings
│   │   ├── content/
│   │   │   └── index.tsx         # Content script — page extraction + sidebar mount
│   │   └── index.css
│   ├── public/
│   │   └── manifest.json
│   └── vite.config.ts
├── assets/                       # Screenshots
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

## Security

- API keys stored with `chrome.storage.local` — local to your browser only
- All AI calls go directly from browser → provider API
- No telemetry, no analytics, no backend receiving your data
- `.env` files are gitignored — never commit secrets
- Keys are auto-cleared on 401

---

## Roadmap

- [ ] PDF support
- [ ] YouTube transcript extraction
- [ ] Export summary as Markdown
- [ ] Keyboard-navigable insights
- [ ] Firefox support (MV2 port)
- [ ] Pinned notes per page

Open an issue before starting anything major.

---

## License

MIT — do whatever you want with it.

---

<div align="center">

<br/>

Built with Groq inference and too much caffeine.

*If Glimpse saved you 10 minutes today, star the repo.*

⭐

<br/>

</div>
