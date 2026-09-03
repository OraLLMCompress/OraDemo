import "server-only";
import type { ModelId } from "./models";

// Deployment-specific, secret-bearing config. `server-only` makes the build fail
// if this module is ever imported into a client component, so tokens cannot leak
// into the browser bundle.

export interface Endpoint {
  baseURL: string;
  apiKey: string;
  servedModelName: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.local.example to .env.local and fill it in.`);
  }
  return value;
}

// Base URL of an endpoint with any trailing slash removed, plus the /v1 suffix,
// so both "https://host" and "https://host/" produce "https://host/v1".
function baseURL(name: string): string {
  return `${required(name).replace(/\/+$/, "")}/v1`;
}

export function endpointFor(id: ModelId): Endpoint {
  if (id === "stock") {
    return {
      baseURL: baseURL("STOCK_ENDPOINT"),
      apiKey: required("STOCK_TOKEN"),
      servedModelName: process.env.STOCK_MODEL_NAME ?? "qwen3-4b",
    };
  }
  return {
    baseURL: baseURL("ORA_ENDPOINT"),
    apiKey: required("ORA_TOKEN"),
    servedModelName: process.env.ORA_MODEL_NAME ?? "qwen3-4b-ora",
  };
}
