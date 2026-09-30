import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGPTAuth, type ChatGPTAuthData } from "../core/chatgpt-auth";
import { ProtectedAuthStore, type AuthStore } from "../core/protected-store";
import { createResponsesProvider, responsesBody } from "../core/responses";
import { OpenAIRequestError } from "../core/openai-errors";
import { JevConversation } from "../agents/conversante/jev-conversation";

// Somente fixtures sintéticas e HTTP simulado. Não abre contas nem lê memória pessoal.
class MemoryStore implements AuthStore<ChatGPTAuthData> {
  value?: ChatGPTAuthData;
  private tail: Promise<unknown> = Promise.resolve();
  transaction<R>(task: (value: ChatGPTAuthData | undefined, save: (next: ChatGPTAuthData) => Promise<void>) => Promise<R>): Promise<R> {
    const run = this.tail.then(() => task(structuredClone(this.value), async (next) => { this.value = structuredClone(next); }));
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...await exportJWK(publicKey), kid: "fixture", use: "sig", alg: "RS256" };
let expectedNonce = "", audience = "oaiapp_fixture", identity = "fixture-user", invalidNonce = false, invalidSignature = false;
let exchangeCount = 0, refreshCount = 0, revokeCount = 0, refreshError = "", unavailable = false, planEnabled = true, revokeFails = false;
const tokenForms: URLSearchParams[] = [];
const otherKeys = await generateKeyPair("RS256");
const fakeAuthFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("jwks.json")) return Response.json({ keys: [jwk] });
  if (url.endsWith("openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", revocation_endpoint: "https://auth.openai.com/revoke" });
  if (url.endsWith("/revoke")) { revokeCount++; return new Response(null, { status: revokeFails ? 503 : 200 }); }
  if (url.endsWith("/models")) return Response.json({ models: [{ slug: "gpt-6-luna", display_name: "Luna", visibility: "list" }, { slug: "hidden", display_name: "Interno", visibility: "hide" }] });
  assert.equal(url, "https://auth.openai.com/api/accounts/oauth/token");
  const form = new URLSearchParams(String(init?.body)); tokenForms.push(form);
  if (unavailable) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  if (form.get("grant_type") === "refresh_token") {
    refreshCount++;
    if (refreshError) return Response.json({ error: refreshError }, { status: 400 });
    return Response.json({ access_token: "renewed-synthetic", refresh_token: "rotated-synthetic", token_type: "Bearer", expires_in: 3600 });
  }
  exchangeCount++;
  const idToken = await new SignJWT({ nonce: invalidNonce ? "wrong-nonce" : expectedNonce, email: "fixture@example.invalid", name: "Conta de teste" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setIssuer("https://auth.openai.com").setAudience(audience)
    .setSubject(identity).setIssuedAt().setExpirationTime("1h").sign(invalidSignature ? otherKeys.privateKey : privateKey);
  return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: idToken,
    token_type: "Bearer", expires_in: 3600, scope: planEnabled ? "openid profile offline_access chatgpt.tokens.use.direct resource.invoke" : "openid profile" });
};

const store = new MemoryStore();
const auth = new ChatGPTAuth({ store, fetch: fakeAuthFetch });
const callbackUri = "http://127.0.0.1:3000/auth/callback";
async function attempt(accountId?: string, selectedAuth = auth) {
  const url = new URL(await selectedAuth.beginSignIn(callbackUri, "browser-fixture", accountId));
  expectedNonce = url.searchParams.get("nonce")!;
  const callback = new URL(callbackUri);
  callback.search = new URLSearchParams({ code: "synthetic-code", state: url.searchParams.get("state")!, client_id: "oaiapp_fixture" }).toString();
  return { url, callback };
}

await assert.rejects(auth.accessToken(), /Conecte/);
await assert.rejects(auth.beginSignIn("http://localhost:3000/auth/callback", "browser-fixture"), /127.0.0.1/);
const first = await attempt();
assert.equal(first.url.searchParams.get("client_id"), "dynamic_agent_client");
assert.equal(first.url.searchParams.get("agent_name_hint"), "Gudman");
assert.equal(first.url.searchParams.get("code_challenge_method"), "S256");
assert.ok(first.url.searchParams.get("scope")?.includes("chatgpt.tokens.use.direct"));
assert.ok(!first.url.searchParams.has("client_secret"));
const invalid = new URL(first.callback); invalid.searchParams.set("state", "wrong-state");
await assert.rejects(auth.completeSignIn(invalid, "browser-fixture"), /validado/);
assert.equal(exchangeCount, 0);
await auth.completeSignIn(first.callback, "browser-fixture");
assert.equal(await auth.accessToken(), "synthetic-access");
await assert.rejects(auth.completeSignIn(first.callback, "browser-fixture"), /validado/, "Código não pode ser reutilizado");
const snapshot = await auth.status();
assert.equal(snapshot.connected, true);
assert.equal(snapshot.planEnabled, true);
assert.ok(!JSON.stringify(snapshot).includes("synthetic-access"));
assert.ok(!JSON.stringify(snapshot).includes("idToken"));
const accountId = snapshot.activeId!;
const hostId = store.value!.hostId;
const returning = await attempt(accountId);
assert.equal(returning.url.searchParams.get("client_id"), "oaiapp_fixture");
assert.equal(returning.url.searchParams.get("ext_agent_host_id"), hostId);
assert.ok(!returning.url.searchParams.has("agent_name_hint"));
assert.ok(returning.url.searchParams.has("id_token_hint"));
await assert.rejects(auth.completeSignIn(returning.callback, "other-browser"), /validado/);
for (const mode of ["nonce", "signature", "audience", "identity", "client"]) {
  const pending = await attempt(accountId);
  invalidNonce = mode === "nonce"; invalidSignature = mode === "signature";
  audience = mode === "audience" ? "oaiapp_wrong" : "oaiapp_fixture";
  identity = mode === "identity" ? "different-user" : "fixture-user";
  if (mode === "client") pending.callback.searchParams.set("client_id", "oaiapp_wrong");
  await assert.rejects(auth.completeSignIn(pending.callback, "browser-fixture"));
  assert.equal(await auth.accessToken(), "synthetic-access", "Login inválido preserva a conexão existente");
}
invalidNonce = false; invalidSignature = false; audience = "oaiapp_fixture"; identity = "fixture-user";
const expired = await attempt();
const originalNow = Date.now;
try {
  Date.now = () => originalNow() + 11 * 60_000;
  await assert.rejects(auth.completeSignIn(expired.callback, "browser-fixture"), /validado/);
} finally { Date.now = originalNow; }
const canceled = await attempt();
auth.cancelSignIns();
await assert.rejects(auth.completeSignIn(canceled.callback, "browser-fixture"), /validado/);
const renewableSession = auth.sessionSignal();
store.value!.registrations[0]!.credentials!.expiresAt = 0;
assert.deepEqual(await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]), ["renewed-synthetic", "renewed-synthetic", "renewed-synthetic"]);
assert.equal(refreshCount, 1, "Um único refresh para requisições concorrentes");
assert.equal(renewableSession.aborted, false, "Renovar credenciais não interrompe o turno");
assert.equal(store.value!.registrations[0]!.credentials!.refreshToken, "rotated-synthetic");
assert.equal(tokenForms.at(-1)?.get("client_id"), "oaiapp_fixture");
assert.equal(tokenForms.at(-1)?.get("resource"), "https://api.openai.com/v1");
assert.ok(!tokenForms.at(-1)?.has("scope"));
assert.deepEqual(await auth.listModels(), [{ slug: "gpt-6-luna", displayName: "Luna" }]);
store.value!.registrations[0]!.credentials!.expiresAt = 0;
unavailable = true;
await assert.rejects(auth.accessToken());
assert.ok(store.value!.registrations[0]!.credentials, "Falha temporária preserva credenciais");
unavailable = false; refreshError = "invalid_grant";
await assert.rejects(auth.accessToken(), /expirou/);
assert.equal((await auth.status()).connected, false);
refreshError = ""; planEnabled = false;
const noPlan = await attempt(accountId);
await auth.completeSignIn(noPlan.callback, "browser-fixture");
assert.equal((await auth.status()).connected, true);
assert.equal((await auth.status()).planEnabled, false);
await assert.rejects(auth.accessToken(), /Autorize/);
const consent = await attempt(accountId);
assert.equal(consent.url.searchParams.get("prompt"), "consent");
planEnabled = true;
await auth.completeSignIn(consent.callback, "browser-fixture");
revokeFails = true;
const outgoingSession = auth.sessionSignal();
assert.equal((await auth.signOut()).revoked, false);
assert.equal(outgoingSession.aborted, true, "Desconexão cancela os turnos existentes");
assert.equal(revokeCount, 2, "Revogação temporariamente indisponível tem retry limitado");
assert.equal((await auth.status()).connected, false);
assert.equal((await auth.status()).accounts.length, 1, "Sair preserva o registro da conta");
const afterLogout = await attempt(accountId);
assert.ok(!afterLogout.url.searchParams.has("id_token_hint"));
await auth.completeSignIn(afterLogout.callback, "browser-fixture");
revokeFails = false;
assert.equal((await auth.signOut()).revoked, true);

// Duas contas/workspaces com o mesmo email permanecem independentes e identificáveis.
const firstAgain = await attempt(accountId);
await auth.completeSignIn(firstAgain.callback, "browser-fixture");
const firstLabel = (await auth.status()).accounts[0]!.label;
const firstAccountSession = auth.sessionSignal();
const secondAccount = await attempt();
audience = "oaiapp_second"; identity = "fixture-other-workspace";
secondAccount.callback.searchParams.set("client_id", audience);
await auth.completeSignIn(secondAccount.callback, "browser-fixture");
assert.equal(firstAccountSession.aborted, true);
const twoAccounts = await auth.status();
assert.equal(twoAccounts.accounts.length, 2);
assert.equal(twoAccounts.accounts[0]!.email, twoAccounts.accounts[1]!.email);
assert.equal(twoAccounts.accounts[0]!.label, firstLabel);
assert.notEqual(twoAccounts.accounts[0]!.label, twoAccounts.accounts[1]!.label);
const secondId = twoAccounts.activeId!;
await auth.signOut();
assert.equal((await auth.status()).accounts.find((entry) => entry.id === accountId)!.signedIn, true, "Desconectar uma conta preserva a outra");
await auth.selectAccount(accountId);
assert.equal(await auth.accessToken(), "synthetic-access");
const retainedCredentials = structuredClone(store.value!.registrations[0]!.credentials);
const wrongExistingClient = await attempt();
audience = "oaiapp_fixture"; identity = "different-user";
await assert.rejects(auth.completeSignIn(wrongExistingClient.callback, "browser-fixture"), /identidade/);
assert.deepEqual(store.value!.registrations[0]!.credentials, retainedCredentials, "Login novo não sobrescreve registro existente com identidade diferente");
assert.equal(store.value!.registrations.find((entry) => entry.id === secondId)!.credentials, undefined);
await auth.signOut();

const request = { model: "gpt-6-luna", instructions: "Instruções de teste", input: "Pergunta sintética" };
const completed = (text: string) => ({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] } });
function streamResponse(events: unknown[], chunkSize = 7) {
  const bytes = new TextEncoder().encode(events.map((event) => `event: ignored\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + chunkSize)); offset += chunkSize;
  } }), { headers: { "Content-Type": "text/event-stream", "x-request-id": "req_fixture" } });
}
let receivedBody: Record<string, unknown> = {}, calls = 0;
let events: unknown[] = [{ type: "response.output_text.delta", delta: "Olá, " }, { type: "response.output_text.delta", delta: "memória 🧠" }, completed("Olá, memória 🧠")];
const provider = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async (input, init) => {
  calls++; assert.equal(String(input), "https://api.openai.com/v1/responses");
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
  receivedBody = JSON.parse(String(init?.body));
  return streamResponse(events);
} });
const chunks: string[] = [];
assert.equal(await provider({ ...request, onContent: (chunk) => chunks.push(chunk) }), "Olá, memória 🧠");
assert.deepEqual(chunks, ["Olá, ", "memória 🧠"]);
assert.deepEqual(receivedBody, responsesBody(request));
assert.ok(!("tools" in receivedBody) && !("temperature" in receivedBody) && !("max_output_tokens" in receivedBody));
assert.equal(receivedBody.store, false); assert.equal(receivedBody.stream, true); assert.ok(Array.isArray(receivedBody.input));
// Retorno real observado: texto e itens no SSE; response.completed traz output vazio.
const metadataOnlyCompletion = { type: "response.completed", response: { status: "completed", output: [] } };
const streamedItem = { type: "message", role: "assistant", id: "msg_fixture", content: [{ type: "output_text", text: "OK" }] };
const sparseEvents = [
  { type: "response.output_text.delta", delta: "O" },
  { type: "response.output_text.delta", delta: "K" },
  { type: "response.output_text.done", output_index: 0, content_index: 0, text: "OK" },
  { type: "response.output_item.done", output_index: 0, item: streamedItem },
  metadataOnlyCompletion,
];
const sparseDiagnostics: unknown[] = [];
const sparseProvider = createResponsesProvider({ accessToken: async () => "synthetic", onDiagnostic: (entry) => sparseDiagnostics.push(entry), fetch: async () => {
  const response = streamResponse(sparseEvents);
  response.headers.delete("Content-Type");
  return response;
} });
const sparseChunks: string[] = [];
assert.equal(await sparseProvider({ ...request, onContent: (chunk) => sparseChunks.push(chunk) }), "OK");
assert.deepEqual(sparseChunks, ["O", "K"], "Texto já transmitido não é repetido na conclusão");
assert.ok(!JSON.stringify(sparseDiagnostics).includes('"text"') && !JSON.stringify(sparseDiagnostics).includes("Bearer"), "Diagnóstico contém apenas metadados");
const sparseAgent = new JevConversation({ answer: sparseProvider, inspect: async () => '{"paths":[],"folders":[],"query":""}', evaluate: async () => ({ search: 0 }), browser: { list: () => [], read: () => "" } });
assert.equal(await sparseAgent.run("Olá"), "OK");
assert.equal(sparseAgent.history.at(-1)?.content, "OK", "Turno completo chega ao histórico do conversador");
const sparseStructured = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => streamResponse([
  { type: "response.output_text.delta", delta: '{"paths":[],"folders":[],"query":""}' },
  metadataOnlyCompletion,
]) });
assert.equal(await sparseStructured({ ...request, outputSchema: { type: "object" } }), '{"paths":[],"folders":[],"query":""}');
const doneOnly = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => streamResponse([
  { type: "response.output_text.done", output_index: 0, content_index: 0, text: "OK" }, metadataOnlyCompletion,
]) });
const doneOnlyChunks: string[] = [];
assert.equal(await doneOnly({ ...request, onContent: (chunk) => doneOnlyChunks.push(chunk) }), "OK");
assert.deepEqual(doneOnlyChunks, ["OK"]);
const sparseEmpty = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => streamResponse([metadataOnlyCompletion]) });
await assert.rejects(sparseEmpty(request), /não entregou texto/);
const sparseMismatch = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => streamResponse([
  { type: "response.output_text.delta", delta: "antes" }, { type: "response.output_item.done", output_index: 0, item: streamedItem }, metadataOnlyCompletion,
]) });
await assert.rejects(sparseMismatch(request), /diverge/);
// O protocolo vem do corpo, não de um Content-Type possivelmente alterado pelo gateway.
for (const mime of [undefined, "application/json", "Text/Event-Stream; charset=utf-8"]) {
  const response = streamResponse([{ type: "response.output_text.delta", delta: "OK" }, completed("OK")]);
  if (mime) response.headers.set("Content-Type", mime); else response.headers.delete("Content-Type");
  const mislabelled = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => response });
  const fragments: string[] = [];
  assert.equal(await mislabelled({ ...request, onContent: (chunk) => fragments.push(chunk) }), "OK");
  assert.deepEqual(fragments, ["OK"], "SSE válido não é rejeitado nem duplicado pelo cabeçalho");
}
const finalJSON = (text: string, status = "completed") => ({ object: "response", ...completed(text).response, status });
const jsonProvider = (value: unknown) => createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => Response.json(value, { headers: { "x-request-id": "req_json_fixture" } }) });
const jsonFragments: string[] = [];
assert.equal(await jsonProvider(finalJSON("Resposta final 🧠"))({ ...request, onContent: (chunk) => jsonFragments.push(chunk) }), "Resposta final 🧠");
assert.deepEqual(jsonFragments, ["Resposta final 🧠"]);
jsonFragments.length = 0;
assert.equal(await jsonProvider(finalJSON('{"paths":[]}'))({ ...request, outputSchema: { type: "object" }, onContent: (chunk) => jsonFragments.push(chunk) }), '{"paths":[]}');
assert.deepEqual(jsonFragments, [], "JSON de inspeção continua reservado à orquestração");
await assert.rejects(jsonProvider({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "synthetic-access" } })(request),
  (error: unknown) => error instanceof OpenAIRequestError && error.status === 429 && !error.message.includes("synthetic-access"));
for (const status of ["in_progress", "incomplete", "failed"]) await assert.rejects(jsonProvider(finalJSON("Parcial", status))(request));
await assert.rejects(jsonProvider({ text: "Resposta solta, sem confirmação" })(request), /formato incompatível.*HTTP 200.*application\/json.*req_json_fixture/);
const unexpectedHTML = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => new Response("<html>synthetic-private-diagnostic</html>", { headers: { "Content-Type": "text/html" } }) });
await assert.rejects(unexpectedHTML(request), (error: unknown) => error instanceof Error && error.message.includes("tipo text/html") && !error.message.includes("synthetic-private-diagnostic"));
const malformedJSON = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => new Response('{"object":', { headers: { "Content-Type": "application/json" } }) });
await assert.rejects(malformedJSON(request), /JSON inválido/);
const emptyBody = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => new Response(null) });
await assert.rejects(emptyBody(request), /sem conteúdo.*HTTP 200/);
events = [completed('{"paths":[]}')];
chunks.length = 0;
await provider({ ...request, outputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" } } }, required: ["paths"], additionalProperties: false }, onContent: (chunk) => chunks.push(chunk) });
assert.deepEqual(chunks, [], "JSON de inspeção não vaza para o chat");
assert.ok("text" in receivedBody);
events = [completed("JSON inválido")];
await assert.rejects(provider({ ...request, outputSchema: { type: "object" } }), /JSON/);
events = [{ type: "response.output_text.delta", delta: "parcial" }];
await assert.rejects(provider(request), /sem confirmar/);
events.push({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Não expor synthetic-access" } } });
await assert.rejects(provider(request), (error: unknown) => error instanceof OpenAIRequestError && error.status === 429 && !error.message.includes("synthetic-access"));
const agent = new JevConversation({ answer: provider, inspect: async () => '{"paths":[],"folders":[],"query":""}', evaluate: async () => ({ search: 0 }), browser: { list: () => [], read: () => "" } });
await assert.rejects(agent.run("Pergunta sintética"));
assert.equal(agent.history.length, 0, "Resposta parcial com falha não entra no histórico");
for (const event of [{ type: "response.incomplete" }, { type: "response.refusal.delta", delta: "não" }, { type: "response.output_item.added", item: { type: "function_call" } }]) {
  events = [event]; await assert.rejects(provider(request));
}
events = [{ type: "response.output_text.delta", delta: "antes" }, completed("depois")];
await assert.rejects(provider(request), /diverge/);
const canceledRequest = new AbortController(); canceledRequest.abort();
const before = calls;
await assert.rejects(provider({ ...request, signal: canceledRequest.signal }), { name: "AbortError" });
assert.equal(calls, before);
const hanging = createResponsesProvider({ timeoutMs: 15, accessToken: async () => "synthetic", fetch: async () => new Response(new ReadableStream<Uint8Array>(), { headers: { "Content-Type": "text/event-stream" } }) });
// AbortSignal.timeout não mantém o processo vivo; o servidor HTTP real mantém.
const keepAlive = setTimeout(() => undefined, 1000);
try { await assert.rejects(hanging(request), /limite de tempo/); }
finally { clearTimeout(keepAlive); }
const denied = createResponsesProvider({ accessToken: async () => "synthetic", fetch: async () => Response.json({ detail: "sensitive diagnostic" }, { status: 403 }) });
await assert.rejects(denied(request), (error: unknown) => error instanceof OpenAIRequestError && !error.message.includes("sensitive diagnostic"));

const directory = await mkdtemp(join(tmpdir(), "gudy-auth-test-"));
try {
  const protectedStore = new ProtectedAuthStore<{ synthetic: string; count: number }>(directory);
  await protectedStore.transaction(async (_, save) => { await save({ synthetic: "Somente teste á 🧠", count: 0 }); });
  await Promise.all(Array.from({ length: 3 }, () => protectedStore.transaction(async (value, save) => { await save({ ...value!, count: value!.count + 1 }); })));
  await protectedStore.transaction(async (value) => { assert.equal(value!.count, 3); assert.equal(value!.synthetic, "Somente teste á 🧠"); });
  if (process.platform === "win32") assert.ok(!(await readFile(join(directory, "accounts.dat"), "utf8")).includes("Somente teste"));
  else assert.equal((await stat(join(directory, "accounts.dat"))).mode & 0o777, 0o600);
} finally {
  // Diretório absoluto criado acima por mkdtemp, exclusivamente com dados sintéticos.
  assert.ok(directory.startsWith(join(tmpdir(), "gudy-auth-test-")));
  await rm(directory, { recursive: true, force: true });
}
console.log("✓ Responses API: OAuth/PKCE, identidade assinada, consentimento, refresh serializado, armazenamento protegido, SSE, JSON, cotas, falhas e cancelamento (sem chamadas reais).");
