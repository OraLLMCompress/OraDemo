import { NextRequest } from "next/server";
import OpenAI from "openai";
import { GEN } from "@/lib/models";
import { endpointFor } from "@/lib/server-config";
import type { GenEvent, GenerateRequest } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `chat_template_kwargs` is a common serving-engine extra (e.g. to toggle a
// model's thinking mode) that is not part of the OpenAI schema. Extend the typed
// params rather than casting the whole object, so the known fields stay checked.
type CreateParams = OpenAI.ChatCompletionCreateParamsStreaming & {
  chat_template_kwargs?: Record<string, unknown>;
};

// One model per request. The page fires two of these in parallel so the columns
// stream independently — one endpoint being slow or failing never blocks the
// other. The token stays here, server-side; the browser only ever sees deltas
// and the final metrics. `messages` is the column's full conversation history,
// so the model has multi-turn context.
export async function POST(req: NextRequest) {
  const { model, messages } = (await req.json()) as GenerateRequest;
  if (model !== "stock" && model !== "ora") {
    return new Response("unknown model", { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages required", { status: 400 });
  }

  const { baseURL, apiKey, servedModelName } = endpointFor(model);
  const client = new OpenAI({ baseURL, apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // TTFT is measured from request send to the first visible token, so it
      // includes the network round trip — the real perceived latency.
      // Throughput is completion tokens over generation time (after TTFT).
      const t0 = performance.now();
      let tFirst = 0;
      let completionTokens = 0;

      try {
        const params: CreateParams = {
          model: servedModelName,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: GEN.temperature,
          top_p: GEN.top_p,
          max_tokens: GEN.max_tokens,
          seed: GEN.seed,
          chat_template_kwargs: { enable_thinking: GEN.enable_thinking },
        };
        const completion = await client.chat.completions.create(params);

        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            if (!tFirst) tFirst = performance.now();
            send({ type: "delta", delta });
          }
          // The final usage chunk (include_usage) carries the exact token count.
          if (chunk.usage) completionTokens = chunk.usage.completion_tokens ?? 0;
        }

        const tEnd = performance.now();
        const ttftMs = tFirst ? tFirst - t0 : tEnd - t0;
        const genMs = tFirst ? tEnd - tFirst : 0;
        const tps = genMs > 0 ? (completionTokens / genMs) * 1000 : 0;

        send({
          type: "done",
          ttftMs: Math.round(ttftMs),
          tps: Number(tps.toFixed(1)),
          tokens: completionTokens,
        });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "stream failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
