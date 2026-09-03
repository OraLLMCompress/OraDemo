"use client";

import { memo, useEffect, useRef, useState } from "react";
import { EventSourceParserStream } from "eventsource-parser/stream";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { MODELS, ORDER, type ModelId } from "@/lib/models";
import type { GenEvent } from "@/lib/events";
import { OraMark } from "@/components/OraMark";

type UserMsg = { role: "user"; content: string };
type AssistantMsg = {
  role: "assistant";
  content: string;
  ttftMs?: number;
  tps?: number;
  tokens?: number;
  error?: string;
};
type Msg = UserMsg | AssistantMsg;

// Each column is an independent conversation with one model.
type ColState = { messages: Msg[]; running: boolean };

const emptyCol: ColState = { messages: [], running: false };

function lastDoneTps(c: ColState): number | undefined {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const m = c.messages[i];
    if (m.role === "assistant" && m.tps != null) return m.tps;
  }
  return undefined;
}

export default function Page() {
  const [input, setInput] = useState("Explain how a jet engine works, in three sentences.");
  const [busy, setBusy] = useState(false);
  const [cols, setCols] = useState<Record<ModelId, ColState>>({
    stock: emptyCol,
    ora: emptyCol,
  });
  const abortRef = useRef<AbortController | null>(null);

  const update = (id: ModelId, fn: (c: ColState) => ColState) =>
    setCols((prev) => ({ ...prev, [id]: fn(prev[id]) }));

  // Patch the most recent assistant message in a column (the one streaming now).
  function patchLastAssistant(id: ModelId, fn: (m: AssistantMsg) => AssistantMsg) {
    update(id, (c) => {
      const messages = c.messages.slice();
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          messages[i] = fn(messages[i] as AssistantMsg);
          break;
        }
      }
      return { ...c, messages };
    });
  }

  async function stream(id: ModelId, history: Msg[], signal: AbortSignal) {
    // Send only role/content — metrics are client-side annotations. Drop any
    // empty assistant turn (e.g. a prior errored reply) so history stays valid.
    const payload = history
      .filter((m) => m.role === "user" || m.content.trim() !== "")
      .map(({ role, content }) => ({ role, content }));

    let res: Response;
    try {
      res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id, messages: payload }),
        signal,
      });
    } catch {
      if (signal.aborted) return;
      patchLastAssistant(id, (m) => ({ ...m, error: "request failed" }));
      update(id, (c) => ({ ...c, running: false }));
      return;
    }
    if (!res.body) {
      patchLastAssistant(id, (m) => ({ ...m, error: "no stream" }));
      update(id, (c) => ({ ...c, running: false }));
      return;
    }

    const reader = res.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader();

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const msg = JSON.parse(value.data) as GenEvent;
        switch (msg.type) {
          case "delta":
            patchLastAssistant(id, (m) => ({ ...m, content: m.content + msg.delta }));
            break;
          case "done":
            patchLastAssistant(id, (m) => ({
              ...m,
              ttftMs: msg.ttftMs,
              tps: msg.tps,
              tokens: msg.tokens,
            }));
            break;
          case "error":
            patchLastAssistant(id, (m) => ({ ...m, error: msg.error }));
            break;
        }
      }
    } catch {
      if (!signal.aborted) patchLastAssistant(id, (m) => ({ ...m, error: "stream interrupted" }));
    } finally {
      update(id, (c) => ({ ...c, running: false }));
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Each column appends the same user turn to its own history, then an empty
    // assistant turn to stream into. The request carries history + the new turn.
    const histories: Record<ModelId, Msg[]> = { stock: [], ora: [] };
    for (const id of ORDER) {
      histories[id] = [...cols[id].messages, { role: "user", content: text }];
    }

    setCols((prev) => {
      const next = { ...prev };
      for (const id of ORDER) {
        next[id] = {
          running: true,
          messages: [
            ...prev[id].messages,
            { role: "user", content: text },
            { role: "assistant", content: "" },
          ],
        };
      }
      return next;
    });
    setInput("");

    setBusy(true);
    await Promise.all(ORDER.map((id) => stream(id, histories[id], controller.signal)));
    setBusy(false);
  }

  function reset() {
    abortRef.current?.abort();
    setCols({ stock: emptyCol, ora: emptyCol });
    setBusy(false);
  }

  const hasChat = ORDER.some((id) => cols[id].messages.length > 0);
  const sizeRatio = MODELS.stock.weightVramGiB / MODELS.ora.weightVramGiB;
  const oraTps = lastDoneTps(cols.ora);
  const stockTps = lastDoneTps(cols.stock);
  const speedRatio = oraTps && stockTps ? oraTps / stockTps : 0;

  return (
    <main className="wrap">
      <header className="topbar">
        <div className="brand">
          <OraMark className="brand-mark" title="ORA Computing" />
          <span className="brand-name">ORA</span>
        </div>
        <div className="titles">
          <h1>Compression, live</h1>
          <p className="sub">Same prompt · same GPU · one is compressed</p>
        </div>
        {hasChat && (
          <button className="ghost" onClick={reset}>
            New chat
          </button>
        )}
      </header>

      <section className="grid">
        {ORDER.map((id) => (
          <Column key={id} id={id} state={cols[id]} />
        ))}
      </section>

      <div className="reveal-slot">
        {speedRatio > 0 && (
          <p className="reveal">
            <span className="big">{sizeRatio.toFixed(1)}×</span> smaller on the GPU {" · "}
            <span className="big">{speedRatio.toFixed(2)}×</span> throughput
          </p>
        )}
      </div>

      <div className="composer">
        <textarea
          value={input}
          rows={2}
          aria-label="Message both models"
          placeholder="Message both models…  (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button onClick={send} disabled={busy}>
          {busy ? "Generating…" : "Send"}
        </button>
      </div>
    </main>
  );
}

// Memoized so a token landing in one column doesn't re-render the other, and
// finished turns don't re-render while the newest one streams.
const Column = memo(function Column({ id, state }: { id: ModelId; state: ColState }) {
  const cfg = MODELS[id];
  const lastIndex = state.messages.length - 1;

  // This column's thread scrolls on its own. Follow the newest tokens, but stop
  // if the user scrolls up; a new turn (message count grows) re-pins to bottom.
  const threadRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevLen = useRef(0);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (state.messages.length > prevLen.current) stick.current = true;
    prevLen.current = state.messages.length;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [state]);

  // Only user-initiated scrolling (wheel / touch) toggles sticking — programmatic
  // scrollTop never fires these, so following the stream can't disable itself.
  const onUserScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <article className={`col ${cfg.accent}`}>
      <div className="col-head">
        <span className={`dot ${state.running ? "live" : ""}`} />
        <h2>{cfg.label}</h2>
        <span className="weight-badge">{cfg.weightVramGiB} GiB weights</span>
      </div>
      <div className="thread" ref={threadRef} onWheel={onUserScroll} onTouchMove={onUserScroll}>
        {state.messages.length === 0 && <p className="placeholder">No messages yet.</p>}
        {state.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="turn user">
              {m.content}
            </div>
          ) : (
            <AssistantTurn
              key={i}
              msg={m}
              streaming={state.running && i === lastIndex}
            />
          ),
        )}
      </div>
    </article>
  );
});

// Syntax highlighting is skipped while streaming (it re-runs on every token and
// is the main source of jank); it kicks in once the turn is done.
const AssistantTurn = memo(function AssistantTurn({
  msg,
  streaming,
}: {
  msg: AssistantMsg;
  streaming: boolean;
}) {
  return (
    <div className="turn assistant">
      <div className="body">
        {msg.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={streaming ? [] : [rehypeHighlight]}
          >
            {msg.content}
          </ReactMarkdown>
        ) : null}
        {streaming && <span className="caret" />}
      </div>
      {msg.error && <div className="err">{msg.error}</div>}
      {msg.ttftMs != null && (
        <div className="turn-stats">
          <span>
            <strong>{msg.ttftMs}</strong> ms TTFT
          </span>
          <span>
            <strong>{msg.tps}</strong> tok/s
          </span>
          <span>
            <strong>{msg.tokens}</strong> tokens
          </span>
        </div>
      )}
    </div>
  );
});
