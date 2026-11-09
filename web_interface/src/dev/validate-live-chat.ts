import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Import the server only after choosing a synthetic data root. No personal .env,
// memory, OAuth calls or model requests are needed to exercise the ownership gate.
const root = mkdtempSync(join(tmpdir(), "gudy-live-chat-"));
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "discordbot"));
writeFileSync(join(root, "package.json"), "{}");
writeFileSync(join(root, "discordbot", "pyproject.toml"), "");
cpSync(resolve(import.meta.dirname, "../../../src/agents"), join(root, "src/agents"), { recursive: true });
process.env.GUDYBRAIN_ROOT = root;
process.env.GPT_API_KEY = "synthetic-test-key";
process.env.CHAT_MODE = "decisions";
process.env.OPENAI_MODEL = "gpt-6-luna";

const { getPublicSettings } = await import("../server/settings");
process.env.OPENAI_MODEL = "synthetic-responses-model";
process.env.CHAT_MODE = "jev"; // Compatibility must select Decisions, never TypeSafe.
process.env.TYPESAFE_API_KEY = "obsolete-synthetic-key";
let settings = getPublicSettings();
assert.equal(settings.chat.mode, "decisions");
assert.equal(settings.chat.model, "synthetic-responses-model");
assert.equal(settings.agents.find((agent) => agent.id === "recuperador-decisions")?.model, "gpt-6-luna");
assert.equal(settings.integrations.openaiApi, true);
assert.equal("typesafe" in settings.integrations, false);
assert.ok(!JSON.stringify(settings).includes("synthetic-test-key"));
delete process.env.GPT_API_KEY;
settings = getPublicSettings();
assert.equal(settings.integrations.openaiApi, false, "uma chave TypeSafe antiga não configura Decisions");
process.env.GPT_API_KEY = "synthetic-test-key";
process.env.CHAT_MODE = "decisions";
process.env.OPENAI_MODEL = "gpt-6-luna";

const { createChatSession, getChatSession, claimVoiceSession, finishVoiceSession, chatHistory, runChat, deleteChatSession } = await import("../server/chat");
const session = createChatSession();
session.agent.history.push({ role: "user", content: "Contexto anterior sintético." }, { role: "assistant", content: "Resposta anterior." });
const before = claimVoiceSession(session.id, "voice-owner");
assert.equal(before.length, 2);
assert.notEqual(before, session.agent.history, "consulta recebe cópia do histórico");
assert.throws(() => claimVoiceSession(session.id, "second-owner"));
assert.throws(() => chatHistory(session.id), /Encerre/);
assert.throws(() => deleteChatSession(session.id), /Encerre/);
await assert.rejects(runChat(session.id, "texto concorrente", { onContent() {} }), /Encerre/);
finishVoiceSession(session.id, "wrong-owner", [{ role: "assistant", content: "Não deve entrar." }]);
assert.equal(getChatSession(session.id).voiceOwner, "voice-owner");
finishVoiceSession(session.id, "voice-owner", [{ role: "user", content: "Fala sintética." }, { role: "assistant", content: "Legenda falada." }]);
assert.equal(chatHistory(session.id).length, 4);
assert.equal(chatHistory(session.id).at(-1)?.content, "Legenda falada.");
finishVoiceSession(session.id, "voice-owner", [{ role: "assistant", content: "Duplicação." }]);
assert.equal(chatHistory(session.id).length, 4, "fechamento duplicado não duplica histórico");
deleteChatSession(session.id);
assert.throws(() => getChatSession(session.id));
console.log("✓ GPT-Live/chat: configuração Decisions, modelos independentes, posse exclusiva, bloqueio de texto/curadoria/exclusão e incorporação idempotente de legendas.");
