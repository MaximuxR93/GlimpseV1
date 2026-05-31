/// <reference types="chrome" />
import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface SidebarProps {
  pageText:     string;
  pageUrl:      string;
  pageTitle:    string;
  pageType:     "article" | "forum" | "product" | "docs" | "other";
  onClose:      () => void;
  selectedText?: string;   // Highlight & Ask
}

interface Message   { role: "user" | "assistant"; content: string }
interface TrustRating { score: number; reason: string; loading: boolean }

interface InsightBlock {
  type:    "insight" | "data" | "caveat";
  content: string;
  trust?:  TrustRating;
}

interface SummaryResult {
  tldr:               string;       // one-sentence headline
  blocks:             InsightBlock[];
  followUps:          string[];     // 3 suggested follow-up questions
  wordCount:          number;
  readingMinutes:     number;
  compressionRatio:   number;
  generatedInSeconds: number;
}

interface ModelConfig {
  provider: "groq" | "openai" | "anthropic" | "openrouter";
  model:    string;
  apiKey:   string;
}

interface SavedPage {
  url:       string;
  title:     string;
  tldr:      string;
  timestamp: number;
}

interface ApiErrorResponse  { error?: { message?: string } }
interface OpenAIResponse    { choices: Array<{ message: { content: string } }> }
interface AnthropicResponse { content:  Array<{ text: string }> }

// ─────────────────────────────────────────────
// MODEL LISTS
// ─────────────────────────────────────────────

const GROQ_MODELS = [
  { id: "llama-3.3-70b-versatile",   label: "Llama 3.3 70B" },
  { id: "llama-3.1-8b-instant",      label: "Llama 3.1 8B (fast)" },
  { id: "mixtral-8x7b-32768",        label: "Mixtral 8x7B" },
  { id: "gemma2-9b-it",              label: "Gemma 2 9B" },
];
const OPENAI_MODELS = [
  { id: "gpt-4o-mini",   label: "GPT-4o Mini" },
  { id: "gpt-4o",        label: "GPT-4o" },
  { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
];
const ANTHROPIC_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
];
const OPENROUTER_MODELS = [
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "google/gemini-flash-1.5",           label: "Gemini Flash 1.5" },
  { id: "mistralai/mistral-7b-instruct",     label: "Mistral 7B" },
];

const DEFAULT_MODEL: ModelConfig = {
  provider: "groq",
  model:    "llama-3.3-70b-versatile",
  apiKey:   "",
};

// ─────────────────────────────────────────────
// STORAGE  — chrome.storage.local
// More reliable than localStorage in content scripts
// ─────────────────────────────────────────────

function chromeGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([`glimpse_${key}`], (result) => {
        const val = result[`glimpse_${key}`];
        resolve(val !== undefined ? (val as T) : fallback);
      });
    } catch { resolve(fallback); }
  });
}

function chromeSet(key: string, val: unknown): Promise<void> {
  return new Promise((resolve) => {
    try { chrome.storage.local.set({ [`glimpse_${key}`]: val }, resolve); }
    catch { resolve(); }
  });
}

// ─────────────────────────────────────────────
// API  — unified LLM caller
// ─────────────────────────────────────────────

function classifyApiError(status: number, msg: string, provider: string): Error {
  const m = msg.toLowerCase();
  if (status === 401 || m.includes("invalid api key") || m.includes("incorrect api key"))
    return new Error("API_KEY_INVALID");
  if (status === 429 || m.includes("rate limit") || m.includes("quota"))
    return new Error("API_KEY_EXPIRED");
  return new Error(`${provider} error (${status}): ${msg}`);
}

async function callLLM(
  messages:     { role: string; content: string }[],
  config:       ModelConfig,
  systemPrompt: string,
  maxTokens     = 1400,
): Promise<string> {
  const { provider, model, apiKey } = config;
  if (!apiKey) throw new Error("No API key configured. Open Settings to add one.");

  const openAI = async (url: string, extraHeaders: Record<string, string> = {}) => {
    const res = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...extraHeaders },
      body:    JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt }, ...messages], max_tokens: maxTokens, temperature: 0.35 }),
    });
    if (!res.ok) {
      const e = await res.json().catch((): ApiErrorResponse => ({})) as ApiErrorResponse;
      throw classifyApiError(res.status, e?.error?.message ?? "", provider);
    }
    return (await res.json() as OpenAIResponse).choices[0].message.content;
  };

  if (provider === "groq")       return openAI("https://api.groq.com/openai/v1/chat/completions");
  if (provider === "openai")     return openAI("https://api.openai.com/v1/chat/completions");
  if (provider === "openrouter") return openAI("https://openrouter.ai/api/v1/chat/completions", { "HTTP-Referer": "https://glimpse-extension.dev", "X-Title": "Glimpse" });

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
      body:    JSON.stringify({ model, system: systemPrompt, messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const e = await res.json().catch((): ApiErrorResponse => ({})) as ApiErrorResponse;
      throw classifyApiError(res.status, e?.error?.message ?? "", "anthropic");
    }
    return (await res.json() as AnthropicResponse).content[0].text;
  }

  throw new Error("Unknown provider");
}

// ─────────────────────────────────────────────
// PARSE LLM OUTPUT
// ─────────────────────────────────────────────

interface ParsedSummary { tldr: string; blocks: InsightBlock[]; followUps: string[] }

function parseSummaryOutput(raw: string): ParsedSummary {
  const tldr      = raw.match(/\[TLDR\](.*?)(?=\[(?:INSIGHT|DATA|CAVEAT|FOLLOWUP)\]|$)/s)?.[1]?.trim() ?? "";
  const followUps = [...raw.matchAll(/\[FOLLOWUP\](.*?)(?=\[(?:INSIGHT|DATA|CAVEAT|FOLLOWUP)\]|$)/gs)]
    .map(m => m[1].trim()).filter(Boolean).slice(0, 3);

  const blocks: InsightBlock[] = [];
  let current: InsightBlock | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (current && buf.length) { blocks.push({ ...current, content: buf.join(" ").trim() }); current = null; buf = []; }
  };

  for (const line of raw.split("\n")) {
    const t = line.trim();
    if      (t.startsWith("[INSIGHT]")) { flush(); current = { type: "insight", content: "" }; buf.push(t.slice(9).trim()); }
    else if (t.startsWith("[DATA]"))    { flush(); current = { type: "data",    content: "" }; buf.push(t.slice(6).trim()); }
    else if (t.startsWith("[CAVEAT]"))  { flush(); current = { type: "caveat",  content: "" }; buf.push(t.slice(8).trim()); }
    else if (current && !t.startsWith("[")) buf.push(t);
  }
  flush();
  return { tldr, blocks, followUps };
}

// ─────────────────────────────────────────────
// TRUST RATING
// ─────────────────────────────────────────────

async function scoreTrust(claim: string, config: ModelConfig): Promise<{ score: number; reason: string }> {
  const raw = await callLLM(
    [{ role: "user", content: `Claim: "${claim}"` }],
    config,
    `Rate this claim's credibility 0-100 on specificity, verifiability, and plausibility.
Respond ONLY with two lines:
SCORE: <0-100>
REASON: <max 12 words>`,
    150,
  );
  return {
    score:  Math.min(100, Math.max(0, parseInt(raw.match(/SCORE:\s*(\d+)/i)?.[1] ?? "50", 10))),
    reason: raw.match(/REASON:\s*(.+)/i)?.[1]?.trim() ?? "Unable to evaluate.",
  };
}

// ─────────────────────────────────────────────
// HIGHLIGHT & ASK
// ─────────────────────────────────────────────

async function askAboutSelection(selected: string, question: string, context: string, config: ModelConfig): Promise<string> {
  return callLLM(
    [{ role: "user", content: `Selected text: "${selected}"\n\nQuestion: ${question}` }],
    config,
    `You are Glimpse. Answer the question about the selected text concisely (2-4 sentences). Page context: ${context.slice(0, 3000)}`,
    400,
  );
}

// ─────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────

const SettingsPanel = memo(function SettingsPanel({
  config, onChange, onBack,
}: { config: ModelConfig; onChange: (c: ModelConfig) => void; onBack: () => void }) {
  const [local,   setLocal]   = useState<ModelConfig>(config);
  const [showKey, setShowKey] = useState(false);

  const models = local.provider === "groq" ? GROQ_MODELS : local.provider === "openai" ? OPENAI_MODELS : local.provider === "anthropic" ? ANTHROPIC_MODELS : OPENROUTER_MODELS;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 24, marginBottom: 28 }}>
        <button onClick={onBack} style={S.backBtn} aria-label="Back">←</button>
        <span style={S.panelTitle}>Model Settings</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1, overflowY: "auto" }}>

        {/* Provider */}
        <div>
          <label style={S.label}>Provider</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            {(["groq","openai","anthropic","openrouter"] as const).map(p => (
              <button key={p}
                onClick={() => setLocal(prev => ({ ...prev, provider: p, model: (p==="groq"?GROQ_MODELS:p==="openai"?OPENAI_MODELS:p==="anthropic"?ANTHROPIC_MODELS:OPENROUTER_MODELS)[0].id }))}
                style={{ ...S.providerBtn, background: local.provider===p?"var(--g-accent)":"var(--g-surface)", color: local.provider===p?"#fff":"var(--g-text)", border:`1.5px solid ${local.provider===p?"var(--g-accent)":"var(--g-border)"}` }}
              >
                {p==="openrouter"?"OpenRouter":p[0].toUpperCase()+p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Model */}
        <div>
          <label style={S.label}>Model</label>
          <select value={local.model} onChange={e => setLocal(p => ({ ...p, model: e.target.value }))} style={{ ...S.input, marginTop: 8, cursor: "pointer" }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            <option value="__custom__">Custom model ID…</option>
          </select>
          {local.model === "__custom__" && (
            <input type="text" placeholder="e.g. meta-llama/llama-3.3-70b-instruct" style={{ ...S.input, marginTop: 8 }}
              onChange={e => setLocal(p => ({ ...p, model: e.target.value }))} />
          )}
        </div>

        {/* API Key */}
        <div>
          <label style={S.label}>API Key</label>
          <div style={{ position: "relative", marginTop: 8 }}>
            <input type={showKey?"text":"password"} value={local.apiKey}
              onChange={e => setLocal(p => ({ ...p, apiKey: e.target.value }))}
              placeholder={`Enter ${local.provider} API key`} style={{ ...S.input, paddingRight: 44 }} />
            <button onClick={() => setShowKey(s => !s)}
              style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--g-text-muted)", fontSize:12, fontFamily:"inherit" }}>
              {showKey?"Hide":"Show"}
            </button>
          </div>
          <p style={{ fontSize:11, color:"var(--g-text-muted)", marginTop:6 }}>Stored locally. Never sent to Glimpse servers.</p>
        </div>

        {/* Key links */}
        <div style={{ background:"var(--g-surface)", borderRadius:10, padding:"12px 14px", border:"1px solid var(--g-border)" }}>
          <p style={{ fontSize:11, color:"var(--g-text-muted)", margin:0, lineHeight:1.6 }}>
            🔑 Free keys:{" "}
            {([["Groq","https://console.groq.com/keys"],["OpenAI","https://platform.openai.com/api-keys"],["Anthropic","https://console.anthropic.com/settings/keys"],["OpenRouter","https://openrouter.ai/keys"]] as const).map(([n,u],i,a) => (
              <span key={n}><a href={u} target="_blank" rel="noreferrer" style={S.link}>{n}</a>{i<a.length-1?" · ":""}</span>
            ))}
          </p>
        </div>

        <button onClick={() => { onChange(local); onBack(); }} style={S.primaryBtn}>Save & Apply</button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// HISTORY PANEL
// ─────────────────────────────────────────────

const HistoryPanel = memo(function HistoryPanel({
  onBack, onLoad,
}: { onBack: () => void; onLoad: (s: SavedPage) => void }) {
  const [pages, setPages] = useState<SavedPage[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    chromeGet<SavedPage[]>("history", []).then(h => { setPages(h); setReady(true); }).catch(() => setReady(true));
  }, []);

  const clear = () => {
    void chromeSet("history", []);
    setPages([]);
    onBack();
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", padding:"0 20px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:24, marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={onBack} style={S.backBtn}>←</button>
          <span style={S.panelTitle}>Recent Analyses</span>
        </div>
        {pages.length > 0 && <button onClick={clear} style={{ fontSize:11, color:"var(--g-danger)", background:"none", border:"none", cursor:"pointer" }}>Clear all</button>}
      </div>
      {!ready ? (
        <div style={{ textAlign:"center", paddingTop:60, color:"var(--g-text-muted)", fontSize:13 }}>Loading…</div>
      ) : pages.length === 0 ? (
        <EmptyState icon="📭" title="No saved analyses yet" body="Summarise a page to build your history." />
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10, overflowY:"auto" }}>
          {[...pages].reverse().map((p, i) => (
            <button key={i} onClick={() => { onLoad(p); onBack(); }}
              style={{ background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:12, padding:"12px 14px", textAlign:"left", cursor:"pointer" }}>
              <p style={{ fontSize:12, fontWeight:600, color:"var(--g-text)", margin:"0 0 3px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.title||p.url}</p>
              {p.tldr && <p style={{ fontSize:11, color:"var(--g-text-muted)", margin:"0 0 4px", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{p.tldr}</p>}
              <p style={{ fontSize:10, color:"var(--g-text-muted)", margin:0 }}>{new Date(p.timestamp).toLocaleString()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────
// HIGHLIGHT & ASK PANEL
// ─────────────────────────────────────────────

const QUICK_ACTIONS = ["Explain simply", "Why does this matter?", "Fact-check this", "What's the context?", "Simplify for a beginner"];

const HighlightPanel = memo(function HighlightPanel({
  selectedText, pageText, config, onBack, onSendToChat,
}: {
  selectedText: string; pageText: string; config: ModelConfig;
  onBack: () => void; onSendToChat: (q: string, a: string) => void;
}) {
  const [answer,  setAnswer]  = useState<string|null>(null);
  const [loading, setLoading] = useState(false);
  const [activeQ, setActiveQ] = useState<string|null>(null);
  const [customQ, setCustomQ] = useState("");

  const ask = useCallback(async (q: string) => {
    if (!config.apiKey) { setAnswer("No API key set. Open Settings to add one."); return; }
    setLoading(true); setActiveQ(q); setAnswer(null);
    try   { setAnswer(await askAboutSelection(selectedText, q, pageText, config)); }
    catch (e: unknown) { setAnswer(`⚠ ${e instanceof Error ? e.message : String(e)}`); }
    finally { setLoading(false); }
  }, [selectedText, pageText, config]);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", padding:"0 20px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, paddingTop:24, marginBottom:16 }}>
        <button onClick={onBack} style={S.backBtn}>←</button>
        <span style={S.panelTitle}>Highlight & Ask</span>
      </div>

      {/* Selected text */}
      <div style={{ background:"rgba(83,74,183,0.06)", border:"1px solid rgba(83,74,183,0.2)", borderRadius:10, padding:"10px 12px", marginBottom:14 }}>
        <p style={{ fontSize:10, fontWeight:700, color:"var(--g-accent)", textTransform:"uppercase", letterSpacing:"0.07em", margin:"0 0 4px" }}>Selected</p>
        <p style={{ fontSize:12, color:"var(--g-text)", margin:0, lineHeight:1.5, display:"-webkit-box", WebkitLineClamp:4, WebkitBoxOrient:"vertical", overflow:"hidden", fontStyle:"italic" }}>"{selectedText}"</p>
      </div>

      {/* Quick actions */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:12 }}>
        {QUICK_ACTIONS.map(q => (
          <button key={q} onClick={() => ask(q)} disabled={loading}
            style={{ background:activeQ===q?"var(--g-accent)":"var(--g-surface)", color:activeQ===q?"#fff":"var(--g-text)", border:`1px solid ${activeQ===q?"var(--g-accent)":"var(--g-border)"}`, borderRadius:20, padding:"5px 11px", fontSize:11, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.15s" }}>
            {q}
          </button>
        ))}
      </div>

      {/* Custom question */}
      <div style={{ display:"flex", gap:6, marginBottom:14 }}>
        <input type="text" value={customQ} onChange={e => setCustomQ(e.target.value)}
          onKeyDown={e => e.key==="Enter" && customQ.trim() && void ask(customQ.trim())}
          placeholder="Ask anything about this text…" style={{ ...S.input, flex:1 }} />
        <button onClick={() => customQ.trim() && void ask(customQ.trim())} disabled={loading||!customQ.trim()}
          style={{ background:"var(--g-accent)", border:"none", borderRadius:10, padding:"9px 14px", color:"#fff", fontSize:13, cursor:"pointer", opacity:loading||!customQ.trim()?0.5:1 }}>
          →
        </button>
      </div>

      {/* Answer */}
      {loading && (
        <div style={{ display:"flex", gap:5, alignItems:"center", padding:"12px 0" }}>
          {[0,1,2].map(i => <div key={i} className="g-dot-bounce" style={{"--i":i} as React.CSSProperties} />)}
        </div>
      )}
      {answer && (
        <div style={{ background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:12, padding:"12px 14px", flex:1, overflowY:"auto" }}>
          <p style={{ fontSize:10, fontWeight:700, color:"var(--g-accent)", textTransform:"uppercase", letterSpacing:"0.07em", margin:"0 0 8px" }}>{activeQ}</p>
          <p style={{ fontSize:13, color:"var(--g-text)", margin:0, lineHeight:1.6 }}>{answer}</p>
          <button onClick={() => onSendToChat(activeQ!, answer)}
            style={{ marginTop:12, background:"none", border:"1px solid var(--g-border)", borderRadius:8, padding:"5px 10px", fontSize:11, color:"var(--g-text-muted)", cursor:"pointer", fontFamily:"inherit" }}>
            Continue in chat →
          </button>
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────
// INSIGHT CARD
// ─────────────────────────────────────────────

const InsightCard = memo(function InsightCard({ block, onTrust }: { block: InsightBlock; onTrust: () => void }) {
  const MAP = {
    insight: { icon:"🧠", label:"Key Insight", bg:"rgba(83,74,183,0.07)",  border:"rgba(83,74,183,0.18)",  text:"#534AB7" },
    data:    { icon:"📊", label:"Data",        bg:"rgba(29,158,117,0.07)", border:"rgba(29,158,117,0.18)", text:"#0F6E56" },
    caveat:  { icon:"⚠",  label:"Caveat",      bg:"rgba(220,130,0,0.07)",  border:"rgba(220,130,0,0.18)",  text:"#9A6000" },
  } as const;
  const cfg = MAP[block.type];
  const t   = block.trust;
  const trustColor = t && !t.loading ? (t.score>=70?"#0F6E56":t.score>=40?"#9A6000":"#B33030") : "var(--g-text-muted)";

  return (
    <div style={{ background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:12, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
        <span style={{ fontSize:14 }}>{cfg.icon}</span>
        <span style={{ fontSize:10, fontWeight:700, color:cfg.text, textTransform:"uppercase", letterSpacing:"0.07em" }}>{cfg.label}</span>
      </div>
      <p style={{ fontSize:13, color:"var(--g-text)", margin:"0 0 10px", lineHeight:1.55 }}>{block.content}</p>

      {t && (
        <div style={{ background:"rgba(0,0,0,0.04)", borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
          {t.loading ? (
            <span style={{ fontSize:11, color:"var(--g-text-muted)" }}>Evaluating…</span>
          ) : (
            <>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <span style={{ fontSize:10, fontWeight:700, color:"var(--g-text-muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>AI Trust</span>
                <span style={{ fontSize:13, fontWeight:700, color:trustColor }}>{t.score}/100</span>
              </div>
              <div style={{ height:4, background:"rgba(0,0,0,0.08)", borderRadius:99, overflow:"hidden", marginBottom:5 }}>
                <div style={{ height:"100%", width:`${t.score}%`, background:t.score>=70?"#1D9E75":t.score>=40?"#D4A017":"#C13030", borderRadius:99, transition:"width 0.5s ease" }} />
              </div>
              <p style={{ fontSize:11, color:"var(--g-text-muted)", margin:0 }}>{t.reason}</p>
            </>
          )}
        </div>
      )}

      <button onClick={onTrust} disabled={t?.loading}
        style={{ width:"100%", borderRadius:7, padding:"5px 8px", fontSize:10, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase", fontFamily:"inherit", background:t?"rgba(83,74,183,0.08)":"rgba(0,0,0,0.04)", border:`1px solid ${t?"rgba(83,74,183,0.2)":"rgba(0,0,0,0.08)"}`, color:t?"var(--g-accent)":"var(--g-text-muted)", cursor:t?.loading?"not-allowed":"pointer" }}>
        {t?.loading?"Rating…":t?"Re-rate":"🤖 AI Trust"}
      </button>
    </div>
  );
});

// ─────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────

const GlimpseShell = memo(function GlimpseShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width:360, height:"100vh", display:"flex", flexDirection:"column", background:"var(--g-bg)", borderLeft:"1px solid var(--g-border)", fontFamily:"'DM Sans',-apple-system,sans-serif", position:"relative", overflow:"hidden" }}>
      <style>{CSS}</style>
      {children}
    </div>
  );
});

const GlimpseLogo = memo(function GlimpseLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 28 28" fill="none">
      <path d="M3 14C3 14 7.5 6 14 6C20.5 6 25 14 25 14C25 14 20.5 22 14 22C7.5 22 3 14 3 14Z" stroke="var(--g-accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="14" cy="14" r="4.2" stroke="var(--g-accent)" strokeWidth="1.5" fill="none"/>
      <circle cx="14" cy="14" r="2" fill="var(--g-accent)"/>
    </svg>
  );
});

const StatChip = memo(function StatChip({ label, value, accent }: { label:string; value:string; accent?:boolean }) {
  return (
    <div style={{ background:accent?"rgba(83,74,183,0.08)":"var(--g-surface)", border:`1px solid ${accent?"rgba(83,74,183,0.2)":"var(--g-border)"}`, borderRadius:8, padding:"4px 10px", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <span style={{ fontSize:13, fontWeight:700, color:accent?"var(--g-accent)":"var(--g-text)", lineHeight:1.2 }}>{value}</span>
      <span style={{ fontSize:9, color:"var(--g-text-muted)", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
    </div>
  );
});

const ChatBubble = memo(function ChatBubble({ message }: { message: Message }) {
  const u = message.role==="user";
  return (
    <div style={{ display:"flex", justifyContent:u?"flex-end":"flex-start" }}>
      <div style={{ maxWidth:"82%", background:u?"var(--g-accent)":"var(--g-surface)", color:u?"#fff":"var(--g-text)", border:u?"none":"1px solid var(--g-border)", borderRadius:u?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"10px 13px", fontSize:13, lineHeight:1.55 }}>
        {message.content}
      </div>
    </div>
  );
});

function ActionBtn({ icon, label, onClick }: { icon:string; label:string; onClick:()=>void }) {
  return (
    <button onClick={onClick} style={{ flex:1, background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:10, padding:"7px 10px", fontSize:11, fontWeight:600, color:"var(--g-text-muted)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:5, fontFamily:"inherit" }}>
      <span>{icon}</span>{label}
    </button>
  );
}

function IconBtn({ title, onClick, children }: { title:string; onClick:()=>void; children:React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={{ background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:8, width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:13, color:"var(--g-text-muted)" }}>
      {children}
    </button>
  );
}

function EmptyState({ icon, title, body }: { icon:string; title:string; body:string }) {
  return (
    <div style={{ textAlign:"center", padding:"32px 16px", display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
      <span style={{ fontSize:32 }}>{icon}</span>
      <p style={{ fontSize:13, fontWeight:600, color:"var(--g-text)", margin:0 }}>{title}</p>
      <p style={{ fontSize:12, color:"var(--g-text-muted)", margin:0, lineHeight:1.55 }}>{body}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN SIDEBAR
// ─────────────────────────────────────────────

type Panel = "main" | "settings" | "history" | "highlight";

export default function Sidebar({ pageText, pageUrl, pageTitle, pageType, onClose, selectedText }: SidebarProps) {
  const [panel,       setPanel]       = useState<Panel>(() => selectedText ? "highlight" : "main");
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL);
  const [configReady, setConfigReady] = useState(false);

  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [autoRan,       setAutoRan]       = useState(false);

  const [chatMode,    setChatMode]    = useState(false);
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [input,       setInput]       = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── LOAD CONFIG ON MOUNT ──
  useEffect(() => {
    void chromeGet<ModelConfig>("model_config", DEFAULT_MODEL).then(c => {
      setModelConfig(c); setConfigReady(true);
    });
  }, []);

  // ── PERSIST CONFIG ──
  useEffect(() => {
    if (configReady) void chromeSet("model_config", modelConfig);
  }, [modelConfig, configReady]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const isEmpty        = !pageText || pageText.trim().length < 80;
  const wordCount      = useMemo(() => pageText.trim().split(/\s+/).filter(Boolean).length, [pageText]);
  const readingMinutes = useMemo(() => Math.max(1, Math.round(wordCount / 200)), [wordCount]);

  // ── AUTO-ANALYSE ──
  useEffect(() => {
    if (autoRan || summaryResult || loading || isEmpty || !modelConfig.apiKey || panel !== "main" || !configReady) return;
    setAutoRan(true);
    void handleSummarise();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configReady, modelConfig.apiKey, panel]);

  // ── SUMMARISE ──
  const handleSummarise = useCallback(async () => {
    if (isEmpty) { setError("Not enough text on this page. Try an article or documentation page."); return; }
    setLoading(true); setError(null); setSummaryResult(null);
    const t0 = Date.now();

    const prompt = [
      "You are Glimpse, a precise web page analyst. Respond ONLY in this exact format:",
      "",
      "[TLDR] <one punchy sentence, max 20 words — like a newspaper subheading>",
      "[INSIGHT] <key insight>",
      "[INSIGHT] <another insight if different enough>",
      "[DATA] <specific statistic or concrete fact — only if actual data exists in the page>",
      "[CAVEAT] <limitation, counterpoint, or thing to be aware of>",
      "[FOLLOWUP] <smart follow-up question the reader would want to ask>",
      "[FOLLOWUP] <another follow-up question>",
      "[FOLLOWUP] <a third follow-up question>",
      "",
      "Rules: TLDR required. 1-3 INSIGHTs. DATA only if real numbers exist. Exactly 1 CAVEAT. Exactly 3 FOLLOWUPs.",
      "No preamble, no markdown, no extra text.",
      `Page type: ${pageType}`,
    ].join("\n");

    try {
      const raw     = await callLLM([{ role:"user", content:`Title: ${pageTitle}\nURL: ${pageUrl}\n\nContent:\n${pageText.slice(0,12000)}` }], modelConfig, prompt, 1400);
      const elapsed = (Date.now() - t0) / 1000;
      const { tldr, blocks, followUps } = parseSummaryOutput(raw);
      const summaryWords    = blocks.map(b=>b.content).join(" ").split(/\s+/).filter(Boolean).length;
      const compressionRatio = wordCount > 0 ? Math.min(99, Math.max(0, Math.round((1 - summaryWords/wordCount)*100))) : 0;

      const result: SummaryResult = { tldr, blocks, followUps, wordCount, readingMinutes, compressionRatio, generatedInSeconds: Math.round(elapsed*10)/10 };
      setSummaryResult(result);

      // Save to history
      const history = await chromeGet<SavedPage[]>("history", []);
      await chromeSet("history", [...history.filter(h=>h.url!==pageUrl), { url:pageUrl, title:pageTitle, tldr:tldr||blocks[0]?.content||"", timestamp:Date.now() }].slice(-10));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg==="API_KEY_INVALID" ? "⚠️ Invalid API key. Check it in Settings and try again."
        : msg==="API_KEY_EXPIRED" ? "⚠️ API key quota exhausted. Get a new key and update Settings."
        : msg || "Something went wrong. Check your API key in Settings."
      );
    } finally { setLoading(false); }
  }, [pageText, pageTitle, pageUrl, pageType, modelConfig, isEmpty, wordCount, readingMinutes]);

  // ── CHAT ──
  const handleChat = useCallback(async () => {
    const q = input.trim();
    if (!q || chatLoading) return;
    setInput(""); setChatLoading(true);
    const newMsgs: Message[] = [...messages, { role:"user", content:q }];
    setMessages(newMsgs);
    try {
      const reply = await callLLM(newMsgs, modelConfig,
        `You are Glimpse. Answer questions about this page concisely.\nTitle: ${pageTitle}\nURL: ${pageUrl}\nContent: ${pageText.slice(0,10000)}`);
      setMessages(m => [...m, { role:"assistant", content:reply }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(m => [...m, { role:"assistant", content:
        msg==="API_KEY_INVALID" ? "⚠️ Invalid API key. Open Settings (⚙) to update it."
        : msg==="API_KEY_EXPIRED" ? "⚠️ API key quota exhausted. Update it in Settings (⚙)."
        : `⚠ ${msg}` }]);
    } finally { setChatLoading(false); }
  }, [input, chatLoading, messages, pageTitle, pageUrl, pageText, modelConfig]);

  // ── FOLLOW-UP → CHAT ──
  const askFollowUp = useCallback((q: string) => {
    setChatMode(true);
    const newMsgs: Message[] = [...messages, { role:"user", content:q }];
    setMessages(newMsgs);
    setChatLoading(true);
    void callLLM(newMsgs, modelConfig,
      `You are Glimpse. Answer questions about this page concisely.\nTitle: ${pageTitle}\nURL: ${pageUrl}\nContent: ${pageText.slice(0,10000)}`)
      .then(reply => setMessages(m => [...m, { role:"assistant", content:reply }]))
      .catch((e: unknown) => setMessages(m => [...m, { role:"assistant", content:`⚠ ${e instanceof Error?e.message:String(e)}` }]))
      .finally(() => setChatLoading(false));
  }, [messages, modelConfig, pageTitle, pageUrl, pageText]);

  // ── TRUST ──
  const runTrustRating = useCallback(async (idx: number) => {
    if (!summaryResult) return;
    const content = summaryResult.blocks[idx].content;
    setSummaryResult(p => { if(!p) return p; const b=[...p.blocks]; b[idx]={...b[idx],trust:{score:0,reason:"",loading:true}}; return {...p,blocks:b}; });
    try {
      const res = await scoreTrust(content, modelConfig);
      setSummaryResult(p => { if(!p) return p; const b=[...p.blocks]; b[idx]={...b[idx],trust:{...res,loading:false}}; return {...p,blocks:b}; });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummaryResult(p => { if(!p) return p; const b=[...p.blocks]; b[idx]={...b[idx],trust:{score:0,reason:msg,loading:false}}; return {...p,blocks:b}; });
    }
  }, [summaryResult, modelConfig]);

  // ── EXPORT ──
  const copySummary = useCallback(() => {
    if (!summaryResult) return;
    const lines = [summaryResult.tldr, "", ...summaryResult.blocks.map(b=>`${b.type.toUpperCase()}: ${b.content}`)].join("\n");
    navigator.clipboard.writeText(lines).catch(()=>{});
  }, [summaryResult]);

  const downloadSummary = useCallback((ext: "txt"|"md") => {
    if (!summaryResult) return;
    const header = ext==="md" ? `# ${pageTitle}\n> ${pageUrl}\n> ${new Date().toLocaleString()}\n\n---\n\n**${summaryResult.tldr}**\n` : `${pageTitle}\n${pageUrl}\n\n${summaryResult.tldr}\n`;
    const body   = summaryResult.blocks.map(b => ext==="md" ? `\n## ${b.type[0].toUpperCase()+b.type.slice(1)}\n${b.content}` : `\n${b.type.toUpperCase()}: ${b.content}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([header+body], {type:"text/plain"}));
    a.download = `glimpse-${Date.now()}.${ext}`; a.click();
  }, [summaryResult, pageTitle, pageUrl]);

  // ── PANEL ROUTING ──
  if (panel === "settings") return <GlimpseShell><SettingsPanel config={modelConfig} onChange={c=>setModelConfig(c)} onBack={()=>setPanel("main")} /></GlimpseShell>;
  if (panel === "history")  return <GlimpseShell><HistoryPanel  onBack={()=>setPanel("main")} onLoad={p=>{ setSummaryResult({tldr:p.tldr,blocks:[{type:"insight",content:p.tldr}],followUps:[],wordCount:0,readingMinutes:0,compressionRatio:0,generatedInSeconds:0}); setPanel("main"); }} /></GlimpseShell>;
  if (panel === "highlight" && selectedText) return (
    <GlimpseShell>
      <HighlightPanel selectedText={selectedText} pageText={pageText} config={modelConfig} onBack={()=>setPanel("main")}
        onSendToChat={(q,a)=>{ setMessages([{role:"user",content:q},{role:"assistant",content:a}]); setChatMode(true); setPanel("main"); }} />
    </GlimpseShell>
  );

  // ── MAIN ──
  return (
    <GlimpseShell>

      {/* Top bar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"18px 20px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <GlimpseLogo />
          <span style={{ fontSize:15, fontWeight:700, color:"var(--g-text)", letterSpacing:"-0.01em" }}>glimpse</span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {selectedText && <IconBtn title="Highlight & Ask" onClick={()=>setPanel("highlight")}>✦</IconBtn>}
          <IconBtn title="History"  onClick={()=>setPanel("history")}>⏱</IconBtn>
          <IconBtn title="Settings" onClick={()=>setPanel("settings")}>⚙</IconBtn>
          <IconBtn title="Close"    onClick={onClose}>✕</IconBtn>
        </div>
      </div>

      {/* Page pill */}
      <div style={{ margin:"14px 20px 0", background:"var(--g-surface)", borderRadius:10, padding:"8px 12px", border:"1px solid var(--g-border)", overflow:"hidden" }}>
        <p style={{ fontSize:10, color:"var(--g-text-muted)", margin:"0 0 2px", textTransform:"uppercase", letterSpacing:"0.07em" }}>{pageType}</p>
        <p style={{ fontSize:12, color:"var(--g-text)", margin:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:500 }}>{pageTitle||pageUrl}</p>
      </div>

      {/* Stats */}
      {!chatMode && (
        <div style={{ display:"flex", gap:8, margin:"12px 20px 0" }}>
          <StatChip label="words" value={wordCount.toLocaleString()} />
          <StatChip label="read"  value={`${readingMinutes}m`} />
          {summaryResult && <StatChip label="compressed" value={`${summaryResult.compressionRatio}%`} accent />}
          {summaryResult?.generatedInSeconds ? <StatChip label="gen" value={`${summaryResult.generatedInSeconds}s`} /> : null}
        </div>
      )}

      <div style={{ height:1, background:"var(--g-border)", margin:"16px 0 0" }} />

      {/* Tabs */}
      <div style={{ display:"flex", padding:"0 20px" }}>
        {["Summary","Chat"].map(tab => (
          <button key={tab} onClick={()=>setChatMode(tab==="Chat")}
            style={{ background:"none", border:"none", borderBottom:`2px solid ${(chatMode?tab==="Chat":tab==="Summary")?"var(--g-accent)":"transparent"}`, padding:"10px 16px 10px 0", marginRight:4, cursor:"pointer", fontSize:12, fontWeight:600, color:(chatMode?tab==="Chat":tab==="Summary")?"var(--g-accent)":"var(--g-text-muted)", letterSpacing:"0.04em", transition:"all 0.15s", fontFamily:"inherit" }}>
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:10 }}>

        {/* ── SUMMARY TAB ── */}
        {!chatMode && (
          <>
            {isEmpty && !summaryResult && <EmptyState icon="📄" title="Not much to read here" body="Navigate to an article or docs page for Glimpse to analyse." />}

            {!modelConfig.apiKey && !summaryResult && !loading && (
              <div onClick={()=>setPanel("settings")} style={{ background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:12, padding:"14px 16px", cursor:"pointer" }}>
                <p style={{ fontSize:12, fontWeight:600, color:"var(--g-text)", margin:"0 0 4px" }}>No API key set</p>
                <p style={{ fontSize:11, color:"var(--g-text-muted)", margin:0 }}>Tap to add your Groq, OpenAI, Anthropic, or OpenRouter key — stored only in your browser.</p>
              </div>
            )}

            {error && (
              <div style={{ background:"rgba(220,50,50,0.08)", border:"1px solid rgba(220,50,50,0.25)", borderRadius:12, padding:"12px 14px" }}>
                <p style={{ fontSize:12, color:"var(--g-danger)", margin:0 }}>{error}</p>
              </div>
            )}

            {loading && (
              <>
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0 8px" }}>
                  {[0,1,2].map(i=><div key={i} className="g-dot-bounce" style={{"--i":i} as React.CSSProperties}/>)}
                  <span style={{ fontSize:11, color:"var(--g-text-muted)" }}>Analysing page…</span>
                </div>
                {[80,60,72].map((h,i)=><div key={i} className="g-shimmer" style={{ height:h, borderRadius:12 }}/>)}
              </>
            )}

            {/* TL;DR */}
            {summaryResult?.tldr && (
              <div style={{ background:"var(--g-surface)", borderRadius:12, padding:"12px 14px", border:"1px solid var(--g-border)" }}>
                <p style={{ fontSize:10, fontWeight:700, color:"var(--g-text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", margin:"0 0 5px" }}>TL;DR</p>
                <p style={{ fontSize:14, fontWeight:600, color:"var(--g-text)", margin:0, lineHeight:1.45 }}>{summaryResult.tldr}</p>
              </div>
            )}

            {/* Insight blocks */}
            {summaryResult?.blocks.map((block,i) => (
              <InsightCard key={i} block={block} onTrust={()=>void runTrustRating(i)} />
            ))}

            {/* Follow-up chips */}
            {summaryResult?.followUps && summaryResult.followUps.length > 0 && (
              <div style={{ marginTop:4 }}>
                <p style={{ fontSize:10, fontWeight:700, color:"var(--g-text-muted)", textTransform:"uppercase", letterSpacing:"0.07em", margin:"0 0 8px" }}>Ask next</p>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {summaryResult.followUps.map((q,i) => (
                    <button key={i} onClick={()=>askFollowUp(q)}
                      style={{ background:"var(--g-surface)", border:"1px solid var(--g-border)", borderRadius:10, padding:"8px 12px", textAlign:"left", fontSize:12, color:"var(--g-text)", cursor:"pointer", fontFamily:"inherit", lineHeight:1.4 }}>
                      {q} →
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Export */}
            {summaryResult && (
              <div style={{ marginTop:4, display:"flex", gap:6 }}>
                <ActionBtn icon="📋" label="Copy" onClick={copySummary} />
                <ActionBtn icon="↓"  label=".txt" onClick={()=>downloadSummary("txt")} />
                <ActionBtn icon="↓"  label=".md"  onClick={()=>downloadSummary("md")} />
              </div>
            )}
          </>
        )}

        {/* ── CHAT TAB ── */}
        {chatMode && (
          <>
            {messages.length===0 && <EmptyState icon="💬" title="Ask anything about this page" body="Or tap a suggested question from the summary." />}
            {messages.map((m,i) => <ChatBubble key={i} message={m} />)}
            {chatLoading && (
              <div style={{ display:"flex", gap:6, alignItems:"center", padding:"8px 0" }}>
                {[0,1,2].map(i=><div key={i} className="g-dot-bounce" style={{"--i":i} as React.CSSProperties}/>)}
              </div>
            )}
            <div ref={chatEndRef} />
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding:"0 20px 20px" }}>
        {!chatMode ? (
          <button onClick={()=>void handleSummarise()} disabled={loading||isEmpty} className="g-main-btn">
            {loading?"Analysing…":summaryResult?"Re-analyse":"Analyse Page"}
          </button>
        ) : (
          <div style={{ display:"flex", gap:8 }}>
            <input type="text" value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter") void handleChat(); }}
              placeholder="Ask about this page…"
              style={{ flex:1, background:"var(--g-surface)", border:"1.5px solid var(--g-border)", borderRadius:12, padding:"10px 14px", fontSize:13, color:"var(--g-text)", outline:"none", fontFamily:"inherit" }} />
            <button onClick={()=>void handleChat()} disabled={chatLoading||!input.trim()}
              style={{ background:"var(--g-accent)", border:"none", borderRadius:12, padding:"10px 16px", color:"#fff", fontSize:13, fontWeight:600, cursor:"pointer", opacity:chatLoading||!input.trim()?0.5:1 }}>
              →
            </button>
          </div>
        )}
      </div>
    </GlimpseShell>
  );
}

// ─────────────────────────────────────────────
// FONT INJECTION
// ─────────────────────────────────────────────

if (typeof document !== "undefined" && !document.getElementById("glimpse-font")) {
  const link = document.createElement("link");
  link.id="glimpse-font"; link.rel="stylesheet";
  link.href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}

// ─────────────────────────────────────────────
// THEME + CSS (:host for shadow DOM)
// ─────────────────────────────────────────────

const THEME_LIGHT = `--g-bg:#FAFAF9;--g-surface:#F2F1EE;--g-border:rgba(0,0,0,0.09);--g-text:#1A1A18;--g-text-muted:#7A7972;--g-accent:#534AB7;--g-danger:#C13030;`;
const THEME_DARK  = `--g-bg:#161614;--g-surface:#1E1E1B;--g-border:rgba(255,255,255,0.08);--g-text:#EDEDE8;--g-text-muted:#888880;--g-accent:#7F77DD;--g-danger:#E05555;`;

const CSS = `
  :host { ${THEME_LIGHT} }
  @media (prefers-color-scheme: dark) { :host { ${THEME_DARK} } }
  :host * { box-sizing: border-box; }
  :host .g-shimmer { background: linear-gradient(90deg,var(--g-surface) 25%,rgba(0,0,0,0.06) 50%,var(--g-surface) 75%); background-size:200% 100%; animation:g-shimmer 1.4s infinite; }
  @keyframes g-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  :host .g-dot-bounce { width:6px;height:6px;border-radius:50%;background:var(--g-accent);animation:g-bounce 1.1s ease-in-out infinite;animation-delay:calc(var(--i)*0.18s); }
  @keyframes g-bounce { 0%,80%,100%{transform:scale(0.7);opacity:0.5} 40%{transform:scale(1);opacity:1} }
  :host .g-main-btn { width:100%;background:var(--g-accent);color:#fff;border:none;border-radius:14px;padding:13px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:0.03em;font-family:'DM Sans',-apple-system,sans-serif;transition:opacity 0.15s,transform 0.1s; }
  :host .g-main-btn:disabled{opacity:0.4;cursor:not-allowed;}
  :host .g-main-btn:not(:disabled):hover{opacity:0.9;}
  :host .g-main-btn:not(:disabled):active{transform:scale(0.98);}
`;

// ─────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────

const S = {
  label:      { fontSize:11, fontWeight:700, color:"var(--g-text-muted)", textTransform:"uppercase" as const, letterSpacing:"0.07em" },
  input:      { width:"100%", background:"var(--g-surface)", border:"1.5px solid var(--g-border)", borderRadius:10, padding:"9px 12px", fontSize:13, color:"var(--g-text)", outline:"none", boxSizing:"border-box" as const, fontFamily:"'DM Sans',-apple-system,sans-serif" },
  providerBtn:{ padding:"9px 12px", borderRadius:10, fontSize:12, fontWeight:600, cursor:"pointer", transition:"all 0.15s", fontFamily:"'DM Sans',-apple-system,sans-serif" } as React.CSSProperties,
  primaryBtn: { width:"100%", background:"var(--g-accent)", color:"#fff", border:"none", borderRadius:12, padding:"12px", fontSize:13, fontWeight:700, cursor:"pointer", marginTop:8, fontFamily:"'DM Sans',-apple-system,sans-serif" } as React.CSSProperties,
  backBtn:    { background:"none", border:"none", cursor:"pointer", padding:"6px 8px 6px 0", color:"var(--g-text-muted)", fontSize:18, lineHeight:1 } as React.CSSProperties,
  panelTitle: { fontSize:13, fontWeight:600, letterSpacing:"0.08em", color:"var(--g-text-muted)", textTransform:"uppercase" as const },
  link:       { color:"var(--g-accent)", textDecoration:"none" } as React.CSSProperties,
} as const;