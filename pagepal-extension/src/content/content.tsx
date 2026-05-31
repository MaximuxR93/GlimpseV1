import ReactDOM from "react-dom/client";
import root from "react-shadow";
import { motion, AnimatePresence } from "framer-motion";

import Sidebar from "../components/Sidebar";
import "../index.css";

// ─────────────────────────────────────────────
// SMART PAGE EXTRACTION v2
// ─────────────────────────────────────────────

interface PageData {
  text:  string;
  url:   string;
  title: string;
  type:  "article" | "forum" | "product" | "docs" | "other";
}

function detectPageType(url: string, text: string): PageData["type"] {
  const u = url.toLowerCase();
  if (u.includes("reddit.com") || u.includes("forum") || u.includes("discuss") || u.includes("stackoverflow") || u.includes("news.ycombinator")) return "forum";
  if (u.includes("docs.") || u.includes("/docs/") || u.includes("/api/") || u.includes("developer.")) return "docs";
  if (text.includes("Add to Cart") || text.includes("Buy Now") || u.includes("shop") || u.includes("product") || u.includes("pricing")) return "product";
  if (document.querySelector("article, .post-content, .entry-content, .article-body")) return "article";
  return "other";
}

function extractPageText(): PageData {
  const url   = window.location.href;
  const title = document.title ?? "";

  // ── REDDIT ──
  if (url.includes("reddit.com")) {
    const parts: string[] = [];
    const postTitle = document.querySelector("h1")?.innerText?.trim();
    if (postTitle) parts.push(`POST: ${postTitle}`);
    const postBody = document.querySelector('[data-testid="post-container"] [data-click-id="text"],.RichTextJSON-root,[slot="text-body"]') as HTMLElement | null;
    if (postBody) parts.push(`BODY: ${postBody.innerText?.trim()}`);
    const comments = Array.from(document.querySelectorAll('[data-testid="comment"],.Comment,[id^="comment-"]')).slice(0,15) as HTMLElement[];
    if (comments.length) {
      parts.push("COMMENTS:");
      comments.forEach((c,i) => { const t = c.innerText?.trim(); if (t && t.length>20) parts.push(`[${i+1}] ${t.slice(0,800)}`); });
    }
    return { text: cleanText(parts.join("\n\n")), url, title, type: "forum" };
  }

  // ── SEMANTIC SELECTORS ──
  const semanticSelectors = ["article","main","[role='main']",".article-body",".post-content",".entry-content",".article-content",".prose","#content",".content",".page-content","#main-content",".body-content"];
  for (const sel of semanticSelectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el && el.innerText?.trim().length > 300) {
      const text = cleanText(el.innerText);
      return { text, url, title, type: detectPageType(url, text) };
    }
  }

  // ── DENSITY-BASED ──
  const candidates = Array.from(document.querySelectorAll("div, section, article")) as HTMLElement[];
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    if (el.closest("nav,header,footer,aside,[role='navigation'],[role='banner'],#glimpse-root")) continue;
    const text      = el.innerText?.trim() ?? "";
    const linkText  = Array.from(el.querySelectorAll("a")).map(a=>a.innerText?.trim()).join(" ");
    const paragraphs = el.querySelectorAll("p").length;
    const score = (text.length - linkText.length * 0.5) + paragraphs * 50;
    if (score > bestScore && text.length > 200) { bestScore = score; best = el; }
  }
  if (best) { const text = cleanText(best.innerText); return { text, url, title, type: detectPageType(url, text) }; }

  // ── FALLBACK ──
  const bodyClone = document.body.cloneNode(true) as HTMLElement;
  ["script","style","noscript","svg","iframe","nav","header","footer","aside","[role='navigation']","[role='banner']","[role='complementary']","#glimpse-root",".ad",".advertisement",".cookie-banner",".popup",".modal",".overlay"]
    .forEach(sel => bodyClone.querySelectorAll(sel).forEach(el => el.remove()));
  const bodyText = bodyClone.innerText?.trim();
  if (bodyText && bodyText.length > 100) return { text: cleanText(bodyText), url, title, type: detectPageType(url, bodyText) };

  // ── LAST RESORT ──
  const metaDesc = (document.querySelector('meta[name="description"]') as HTMLMetaElement)?.content ?? "";
  const ogDesc   = (document.querySelector('meta[property="og:description"]') as HTMLMetaElement)?.content ?? "";
  return { text: cleanText(`${title}\n${metaDesc}\n${ogDesc}`), url, title, type: "other" };
}

function cleanText(raw: string): string {
  return raw.replace(/\t/g," ").replace(/[ \t]{2,}/g," ").replace(/\n{3,}/g,"\n\n").replace(/(.)\1{4,}/g,"$1$1$1").trim().slice(0,14000);
}

// ─────────────────────────────────────────────
// EXTRACT BEFORE REACT MOUNTS
// ─────────────────────────────────────────────

const PAGE_DATA = extractPageText();

// ─────────────────────────────────────────────
// MOUNT
// ─────────────────────────────────────────────

const existingRoot = document.getElementById("glimpse-root");

if (!existingRoot) {
  let isOpen       = false;
  let selectedText = "";

  // ── ROOT CONTAINER ──
  const rootContainer = document.createElement("div");
  rootContainer.id = "glimpse-root";
  document.body.appendChild(rootContainer);
  const reactRoot = ReactDOM.createRoot(rootContainer);

  // ── KEYFRAMES ──
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    @keyframes glimpse-pulse {
      0%,100%{box-shadow:0 0 30px rgba(127,119,221,0.5),0 0 60px rgba(29,158,117,0.15);}
      50%{box-shadow:0 0 50px rgba(127,119,221,0.8),0 0 80px rgba(29,158,117,0.3);}
    }
    #glimpse-toggle { animation: glimpse-pulse 3s ease-in-out infinite; }
    #glimpse-toggle:hover { animation: none !important; }
  `;
  document.head.appendChild(styleEl);

  // ── TOGGLE BUTTON ──
  const toggleButton = document.createElement("button");
  toggleButton.id = "glimpse-toggle";

  const eyeSVG = `<svg width="24" height="24" viewBox="0 0 28 28" fill="none">
    <path d="M3 14C3 14 7.5 6 14 6C20.5 6 25 14 25 14C25 14 20.5 22 14 22C7.5 22 3 14 3 14Z" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
    <circle cx="14" cy="14" r="4.2" stroke="white" stroke-width="1.5" fill="none" opacity="0.85"/>
    <circle cx="14" cy="14" r="1.8" fill="white"/>
    <circle cx="21" cy="8" r="1" fill="#5DCAA5" opacity="0.9"/>
  </svg>`;
  const closeXSVG = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 4L14 14M14 4L4 14" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;

  toggleButton.innerHTML = eyeSVG;
  Object.assign(toggleButton.style, {
    position:"fixed", bottom:"28px", right:"28px", width:"58px", height:"58px",
    borderRadius:"18px", border:"1px solid rgba(255,255,255,0.15)",
    background:"linear-gradient(135deg,#534AB7,#3C3489 50%,#0F6E56)",
    color:"white", cursor:"pointer", zIndex:"2147483647",
    backdropFilter:"blur(20px)", display:"flex", alignItems:"center", justifyContent:"center",
    transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1),box-shadow 0.2s ease,border-radius 0.2s ease",
  } as Partial<CSSStyleDeclaration>);
  toggleButton.onmouseenter = () => { toggleButton.style.transform="scale(1.1) translateY(-3px)"; toggleButton.style.boxShadow="0 8px 40px rgba(127,119,221,0.7)"; toggleButton.style.borderRadius="22px"; };
  toggleButton.onmouseleave = () => { toggleButton.style.transform="scale(1) translateY(0)"; toggleButton.style.borderRadius="18px"; };
  document.body.appendChild(toggleButton);

  // ── RENDER ──
  const render = () => {
    toggleButton.innerHTML = isOpen ? closeXSVG : eyeSVG;
    toggleButton.style.background = isOpen
      ? "linear-gradient(135deg,#1a1730,#0d1a14)"
      : "linear-gradient(135deg,#534AB7,#3C3489 50%,#0F6E56)";

    reactRoot.render(
      <root.div>
        <AnimatePresence mode="wait">
          {isOpen && (
            <motion.div key="sidebar"
              initial={{ opacity:0, x:120, scale:0.96 }}
              animate={{ opacity:1, x:0,   scale:1 }}
              exit={{    opacity:0, x:120,  scale:0.96 }}
              transition={{ duration:0.32, ease:[0.22,1,0.36,1] }}
              style={{ position:"fixed", top:0, right:0, height:"100vh", zIndex:2147483646 }}
            >
              <Sidebar
                pageText={PAGE_DATA.text}
                pageUrl={PAGE_DATA.url}
                pageTitle={PAGE_DATA.title}
                pageType={PAGE_DATA.type}
                selectedText={selectedText || undefined}
                onClose={() => { isOpen = false; selectedText = ""; render(); }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </root.div>
    );
  };

  // ── TOGGLE CLICK ──
  toggleButton.onclick = () => {
    // Capture any selected text when opening
    if (!isOpen) selectedText = window.getSelection()?.toString().trim() ?? "";
    else selectedText = "";
    isOpen = !isOpen;
    render();
  };

  // ── KEYBOARD: Alt+G ──
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "g") {
      if (!isOpen) selectedText = window.getSelection()?.toString().trim() ?? "";
      else selectedText = "";
      isOpen = !isOpen;
      render();
    }
  });

  // ── CONTEXT MENU: open highlight panel on text selection ──
  // When user selects text and the sidebar is open, update selectedText live
  document.addEventListener("mouseup", () => {
    if (!isOpen) return;
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel && sel !== selectedText) {
      selectedText = sel;
      render();
    }
  });
}