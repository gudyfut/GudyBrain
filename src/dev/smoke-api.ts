import { loadEnv } from "../core/env";
import { chat, type Message } from "../core/glm";
import { AGENT_PROFILES, resolveModel } from "../agents/registry";

/** Teste rapido: uma chamada nao-stream e uma stream para validar a chave. */
loadEnv();

const apiKey = process.env.GLM_API_KEY;
const model = resolveModel(AGENT_PROFILES.conversante);

async function main() {
  if (!apiKey) {
    console.error("GLM_API_KEY ausente no .env");
    process.exit(1);
  }
  const messages: Message[] = [
    { role: "user", content: "Diga 'ola' em 3 linguas, so isso." },
  ];

  console.log(`[1/2] chamada simples com ${model}...`);
  const reply = await chat(messages, apiKey, { model, maxTokens: 512 });
  console.log("resposta:", reply, "\n");

  console.log("[2/2] streaming (pensamento + resposta)...");
  const streamed = await chat(messages, apiKey, { model, maxTokens: 512 }, {
    onReasoning: (t) => process.stdout.write("\x1b[2m" + t + "\x1b[0m"),
    onContent: (t) => process.stdout.write(t),
  });
  process.stdout.write("\n");
  console.log("(tamanho da resposta final:", streamed.length, "chars)");
}

main().catch((err) => {
  console.error("Falhou:", err);
  process.exit(1);
});
