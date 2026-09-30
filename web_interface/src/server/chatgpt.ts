import "server-only";
import { chatGPTAuth } from "@gudybrain/core/chatgpt-auth";
import { configuredOpenAIModel } from "@gudybrain/core/llm";
import { ensureEnvironment } from "./paths";
import { updateOpenAIModel } from "./settings";

/** Next pode usar localhost internamente; a autoridade pública vem do Host local validado. */
export function localRequestUrl(request: Request): URL {
  const internal = new URL(request.url);
  const host = request.headers.get("host") ?? "";
  if (internal.protocol !== "http:" || !/^127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(host)) throw new Error("A conexão ChatGPT exige a interface local em http://127.0.0.1.");
  try {
    const url = new URL(`http://${host}`);
    url.pathname = internal.pathname;
    url.search = internal.search;
    return url;
  } catch { throw new Error("Endereço local inválido."); }
}

/** Operações de conta só podem ser iniciadas pela interface local. */
export function assertLocalRequest(request: Request, mutation = false): void {
  const url = localRequestUrl(request);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new Error("Origem não autorizada.");
  const origin = request.headers.get("origin");
  if ((mutation && origin !== url.origin) || (origin && origin !== url.origin)) throw new Error("Origem não autorizada.");
}

export async function chatGPTSnapshot() {
  ensureEnvironment();
  return { ...await chatGPTAuth.status(), model: configuredOpenAIModel(), usageUrl: "https://chatgpt.com/settings/usage" };
}

export async function chooseChatGPTModel(model: string): Promise<void> {
  const models = await chatGPTAuth.listModels();
  if (!models.some((entry) => entry.slug === model)) throw new Error("Escolha um modelo disponível para a conta ChatGPT conectada.");
  updateOpenAIModel(model);
}
