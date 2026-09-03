# Ora — Compression, Live

A side-by-side live chat that compares two language-model endpoints on the same
prompt. You type once; both models answer at the same time, token by token. Each
column shows time-to-first-token, throughput, and how much accelerator memory the
model's weights take — so you can see a full-precision model and a compressed one
respond next to each other and read the difference directly.

It talks to any two endpoints that speak the OpenAI chat-completions API, so it is
not tied to a particular serving stack or provider.

The browser never talks to the model endpoints directly. It calls a same-origin
Next.js route that holds the endpoint tokens and proxies the stream, so tokens
stay server-side and there is no CORS to configure.

## Features

- **Two models, one prompt, side by side** — both stream in parallel; a slow or
  failing endpoint never blocks the other.
- **Real, server-measured metrics** — time-to-first-token, throughput
  (tokens/sec), and exact completion-token counts, measured on the server so both
  models are timed identically.
- **The memory story** — each side shows the VRAM its weights occupy, and a
  summary line reports how much smaller and faster the compressed side is.
- **Multi-turn chat** — each column keeps its own conversation history, so
  follow-up turns have context.
- **Tokens stay server-side** — held by the API route, never shipped to the
  browser.

## Prerequisites

- **Node.js 20 or newer** (npm ships with it — see [Step 1](#step-1--install-node-and-npm)).
- **Two endpoints speaking the OpenAI chat-completions API.** Any OpenAI-compatible
  server or hosted provider works. For each you need its base URL and an auth
  token, plus one number: how much accelerator memory the model's weights use
  (see [The weight-memory figures](#the-weight-memory-figures)).

## Step 1 — install Node and npm

`npm` is not a separate program; it ships with Node.js. If `npm --version` prints
"command not found", you just need Node. Check what you have:

```bash
node --version   # want v20+
npm --version
```

If either is missing, install Node one of these ways (macOS):

- **Homebrew:** `brew install node`
- **nvm:** `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`, open a new terminal, then `nvm install --lts`
- **Official installer:** download the LTS `.pkg` from <https://nodejs.org>

No global packages are needed beyond Node itself; everything else is installed
locally by `npm install`.

## Step 2 — install and configure

```bash
npm install                        # installs dependencies into node_modules/
cp .env.local.example .env.local   # then edit .env.local with your endpoints + tokens
```

Everything deployment-specific lives in two files:

- **`.env.local`** — endpoint URLs and tokens (gitignored; secret, never committed).
- **`src/lib/models.ts`** — the display labels, accent colors, and the two
  `weightVramGiB` numbers (safe to commit).

## Step 3 — run

```bash
npm run dev
```

Open <http://localhost:3000> and start chatting: your message goes to both models
at once, and each column keeps its own history. Enter sends (Shift+Enter for a
newline); **New chat** clears both threads. Press `Ctrl-C` in the terminal to stop.

> The very first request after an endpoint has been idle can be slow while the
> model warms up — send a throwaway prompt first if you are presenting.

## The weight-memory figures

The two `weightVramGiB` values in `src/lib/models.ts` are the memory comparison —
the point of the demo — so they should be real, measured numbers, not estimates.

**What it is.** The amount of accelerator memory (VRAM) the model's *parameters*
occupy once loaded. This is deliberately *not* total memory used: inference
servers typically reserve most of the card for the KV cache, so "total used"
looks nearly identical on both sides and hides the difference. Showing weights
only is where compression is visible — for example a 4B model in BF16 is roughly
4 billion params × 2 bytes ≈ 8 GiB, while a ~3-bit compressed copy of the same
model is only a couple of GiB.

**How to get it.** Whatever serves your model reports this when it loads. For
example, vLLM logs a line like `Model loading took 7.56 GiB memory`; other
engines print an equivalent "model weights" figure. Take that number for each
model and set it in `src/lib/models.ts` (`stock` and `ora`). It only changes if
you re-quantize or swap models.

## Configuration reference

`.env.local` (see `.env.local.example`):

| Variable | Required | Description |
| --- | --- | --- |
| `STOCK_ENDPOINT` / `ORA_ENDPOINT` | yes | Base URL of each endpoint, no trailing `/v1` (the app appends it). |
| `STOCK_TOKEN` / `ORA_TOKEN` | yes | Auth token (sent as `Authorization: Bearer …`). |
| `STOCK_MODEL_NAME` / `ORA_MODEL_NAME` | no | The model name each endpoint expects; defaults to `qwen3-4b` / `qwen3-4b-ora`. |

`src/lib/models.ts` holds the two column labels, accent colors, `weightVramGiB`
values, and the shared generation settings (`temperature`, `top_p`, `max_tokens`,
`seed`, and `enable_thinking`).

## How it works

```
Browser ──POST /api/generate──▶ Next.js route ──OpenAI API──▶ model endpoint
        ◀──── SSE stream ───────  (holds token)  ◀── stream ──
```

The page fires one request per model to the same-origin route. The route holds
the token, calls the endpoint with the OpenAI client, and streams back a small
typed event stream: `delta` (a chunk of text), `done` (the final metrics), or
`error`. TTFT and throughput are computed on the server, and the token count comes
from the endpoint's own usage report — not a client-side guess.

## Project layout

| Path | What it is |
| --- | --- |
| `src/app/page.tsx` | The UI — sends prompts to both models, renders the streamed chat and metrics. |
| `src/app/api/generate/route.ts` | Server route — holds the token, calls one endpoint, streams SSE. |
| `src/lib/models.ts` | Client-safe display config and generation settings. |
| `src/lib/server-config.ts` | Server-only endpoint URLs and tokens (guarded by `server-only`). |
| `src/lib/events.ts` | Shared SSE event and message types. |
| `src/components/OraMark.tsx` | The Ora symbol, as an inline SVG. |
| `src/app/globals.css` | Styling. |

## Notes

- **Thinking mode is off** (`enable_thinking: false` in `models.ts`) so the
  columns fill with the answer rather than a chain-of-thought block. If your
  models don't support that flag it is simply ignored. Keep it consistent across
  both sides.
- **Generation settings are identical** for both models, so the only variables
  are the weights and the runtime.
- **Metrics are server-measured.** TTFT is measured from when the route sends the
  request to the first token, so it includes the network round trip — the real
  perceived latency. Throughput is completion tokens over generation time, after
  the first token.

## License

Released under the MIT License — see [LICENSE](LICENSE).
