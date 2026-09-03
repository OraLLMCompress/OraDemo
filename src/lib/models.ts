// Client-safe display config: what each column shows. No secrets here, so this
// module is safe to import from the page. Endpoints and tokens live in
// server-config.ts, which is guarded by `server-only`.
//
// The two `weightVramGiB` values are the memory comparison. Set them to the
// weight-memory figure each serving stack reports on load — see the README
// section "The weight-memory figures".

export type ModelId = "stock" | "ora";

export interface ModelUi {
  id: ModelId;
  label: string;
  weightVramGiB: number;
  accent: "violet" | "gray";
}

export const MODELS: Record<ModelId, ModelUi> = {
  stock: {
    id: "stock",
    label: "Qwen3-4B · BF16",
    weightVramGiB: 7.56, // measured weight memory on load
    accent: "gray",
  },
  ora: {
    id: "ora",
    label: "Qwen3-4B · ORA-W3",
    weightVramGiB: 2.06, // measured weight memory on load
    accent: "violet",
  },
};

// Left-to-right column order.
export const ORDER: ModelId[] = ["stock", "ora"];

// Generation settings — identical for both sides so the only variables are the
// weights and the runtime. `enable_thinking` is a chat-template flag that turns
// off Qwen3's <think> block; servers that don't support it ignore it.
export const GEN = {
  temperature: 0.7,
  top_p: 0.8,
  max_tokens: 2048,
  seed: 42,
  enable_thinking: false,
} as const;
