import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { ProtectedAuthStore, type AuthStore } from "./protected-store";
import { OpenAIRequestError, openAIError } from "./openai-errors";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";

interface Credentials { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number; scopes: string[] }
interface Registration {
  id: string; clientId: string; subject?: string; label?: string; email?: string; credentials?: Credentials;
}
export interface ChatGPTAuthData { version: 1; hostId: string; activeId?: string; registrations: Registration[] }
interface SignInAttempt {
  state: string; nonce: string; verifier: string; browserId: string; redirectUri: string;
  expiresAt: number; registration?: Registration; epoch: number;
}
export interface ChatGPTAccount { id: string; label: string; email?: string; signedIn: boolean; planEnabled: boolean }
export interface ChatGPTStatus { accounts: ChatGPTAccount[]; activeId?: string; connected: boolean; planEnabled: boolean }
export interface ChatGPTModel { slug: string; displayName: string }

export class ChatGPTAuth {
  private readonly store: AuthStore<ChatGPTAuthData>;
  private readonly fetcher: typeof fetch;
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  private readonly attempts = new Map<string, SignInAttempt>();
  private epoch = 0;
  private session = new AbortController();
  constructor(options: { store?: AuthStore<ChatGPTAuthData>; fetch?: typeof fetch } = {}) {
    this.store = options.store ?? new ProtectedAuthStore<ChatGPTAuthData>();
    this.fetcher = options.fetch ?? fetch;
    this.keys = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), { [customFetch]: this.fetcher, timeoutDuration: 15_000 });
  }

  async status(): Promise<ChatGPTStatus> {
    return this.store.transaction(async (stored) => {
      const data = authData(stored);
      const active = data.registrations.find((entry) => entry.id === data.activeId);
      return {
        accounts: data.registrations.filter((entry) => entry.subject).map((entry) => ({ id: entry.id,
          label: `${entry.label || entry.email || "Conta ChatGPT"} · ${entry.id.slice(0, 8)}`, email: entry.email,
          signedIn: Boolean(entry.credentials), planEnabled: Boolean(entry.credentials?.scopes.includes(PLAN_SCOPE)) })),
        activeId: data.activeId, connected: Boolean(active?.credentials), planEnabled: Boolean(active?.credentials?.scopes.includes(PLAN_SCOPE)),
      };
    });
  }

  async beginSignIn(redirectUri: string, browserId: string, accountId?: string): Promise<string> {
    const callback = new URL(redirectUri);
    if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || callback.pathname !== "/auth/callback"
      || callback.search || callback.hash || callback.username || callback.password) throw new Error("O login ChatGPT exige callback local em 127.0.0.1/auth/callback.");
    this.attempts.clear();
    const epoch = ++this.epoch;
    return this.store.transaction(async (stored, save) => {
      const data = authData(stored);
      const registration = accountId ? data.registrations.find((entry) => entry.id === accountId) : undefined;
      if (accountId && !registration) throw new Error("Conta ChatGPT não encontrada.");
      await save(data);
      const state = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      this.attempts.set(state, { state, nonce, verifier, browserId, redirectUri, expiresAt: Date.now() + 10 * 60_000, registration, epoch });
      const url = new URL(`${ISSUER}/api/accounts/authorize`);
      url.search = new URLSearchParams({ client_id: registration?.clientId ?? "dynamic_agent_client",
        ext_agent_host_id: data.hostId, response_type: "code", redirect_uri: redirectUri, scope: SCOPES, resource: RESOURCE,
        state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
        ...(!registration ? { agent_name_hint: "Gudman" } : {}),
        ...(registration?.credentials?.idToken ? { id_token_hint: registration.credentials.idToken } : {}),
        ...(registration?.email ? { login_hint: registration.email } : {}),
        // Consentimento adicional só quando a conexão existente não permite usar o plano.
        ...(registration?.credentials && !registration.credentials.scopes.includes(PLAN_SCOPE) ? { prompt: "consent" } : {}),
      }).toString();
      return url.toString();
    });
  }

  async completeSignIn(callback: URL, browserId: string): Promise<void> {
    const state = callback.searchParams.get("state") ?? "";
    const attempt = this.attempts.get(state);
    this.attempts.delete(state);
    if (!attempt || attempt.epoch !== this.epoch || attempt.expiresAt <= Date.now() || !safeEqual(attempt.browserId, browserId)
      || `${callback.origin}${callback.pathname}` !== attempt.redirectUri) throw new Error("O login não pôde ser validado. Inicie a conexão novamente.");
    if (callback.searchParams.has("error")) throw new Error("A autorização ChatGPT foi cancelada ou recusada. Você pode conectar novamente em Configurações.");
    const code = callback.searchParams.get("code");
    const returnedClient = callback.searchParams.get("client_id");
    const clientId = returnedClient || attempt.registration?.clientId;
    if (!code || !clientId || !/^[a-zA-Z0-9_-]{1,200}$/.test(clientId) || clientId === "dynamic_agent_client"
      || (attempt.registration && clientId !== attempt.registration.clientId)) throw new Error("Registro ChatGPT incompleto ou divergente. Inicie a conexão novamente.");
    await this.store.transaction(async (stored, save) => {
      const data = authData(stored);
      if (attempt.epoch !== this.epoch) throw new Error("Esta tentativa de login foi cancelada.");
      let registration = data.registrations.find((entry) => entry.clientId === clientId);
      if (!registration) { registration = { id: randomUUID(), clientId }; data.registrations.push(registration); }
      // O client ID emitido deve sobreviver inclusive a falhas na troca do código.
      await save(data);
      const tokens = await this.exchange(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
        code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }));
      if (!tokens.idToken) throw new Error("A OpenAI não retornou a identidade do login.");
      let identity;
      try {
        ({ payload: identity } = await jwtVerify(tokens.idToken, this.keys, { issuer: ISSUER, audience: clientId,
          requiredClaims: ["sub", "exp", "iat", "nonce"], clockTolerance: 5, algorithms: ["RS256", "ES256"] }));
      } catch { throw new Error("Não foi possível validar a identidade ChatGPT. Inicie a conexão novamente."); }
      if (typeof identity.sub !== "string" || !identity.sub || identity.nonce !== attempt.nonce
        || (registration.subject && identity.sub !== registration.subject)
        || (attempt.registration?.subject && identity.sub !== attempt.registration.subject)) throw new Error("A identidade recebida não corresponde à tentativa de login.");
      if (attempt.epoch !== this.epoch) throw new Error("Esta tentativa de login foi cancelada.");
      registration.subject = identity.sub;
      registration.email = typeof identity.email === "string" ? identity.email : undefined;
      registration.label = typeof identity.name === "string" ? identity.name : registration.email;
      registration.credentials = tokens;
      data.activeId = registration.id;
      await save(data);
      this.endCurrentSession();
    });
  }

  async accessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const token = await this.store.transaction(async (stored, save) => {
      const data = authData(stored);
      const registration = data.registrations.find((entry) => entry.id === data.activeId);
      let credentials = registration?.credentials;
      if (!registration || !credentials) throw new Error("Conecte sua conta ChatGPT em Configurações para conversar com o Gudman.");
      if (!credentials.scopes.includes(PLAN_SCOPE)) throw new Error("Autorize o uso do plano ChatGPT em Configurações para conversar com o Gudman.");
      if (credentials.expiresAt <= Date.now() + 60_000) {
        if (!credentials.refreshToken) throw new Error("A sessão ChatGPT expirou. Conecte a conta novamente em Configurações.");
        try {
          const next = await this.exchange(new URLSearchParams({ grant_type: "refresh_token", client_id: registration.clientId,
            refresh_token: credentials.refreshToken, resource: RESOURCE }), credentials);
          registration.credentials = next;
          await save(data);
          credentials = next;
        } catch (error) {
          if (error instanceof OpenAIRequestError && new Set(["invalid_grant", "invalid_refresh_token", "token_expired",
            "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused", "refresh_token_invalid"]).has(error.code)) {
            registration.credentials = undefined;
            await save(data);
          }
          throw error;
        }
      }
      if (!credentials.scopes.includes(PLAN_SCOPE)) throw new Error("A permissão de uso do plano ChatGPT não está disponível. Autorize novamente em Configurações.");
      return credentials.accessToken;
    });
    signal?.throwIfAborted();
    return token;
  }

  async selectAccount(id: string): Promise<void> {
    this.cancelSignIns();
    await this.store.transaction(async (stored, save) => {
      const data = authData(stored);
      if (!data.registrations.some((entry) => entry.id === id && entry.subject)) throw new Error("Conta ChatGPT não encontrada.");
      data.activeId = id;
      await save(data);
      this.endCurrentSession();
    });
  }

  cancelSignIns(): void { this.epoch++; this.attempts.clear(); }

  /** Um turno iniciado numa conta não pode continuar usando outra após uma troca. */
  sessionSignal(): AbortSignal { return this.session.signal; }

  private endCurrentSession(): void {
    this.session.abort(new Error("A conexão ChatGPT mudou. Inicie uma nova conversa para continuar."));
    this.session = new AbortController();
  }

  async signOut(): Promise<{ revoked: boolean }> {
    this.cancelSignIns();
    this.endCurrentSession();
    return this.store.transaction(async (stored, save) => {
      const data = authData(stored);
      const registration = data.registrations.find((entry) => entry.id === data.activeId);
      let revoked = true;
      if (registration?.credentials?.refreshToken) {
        try {
          const discovery = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: "error" });
          const config = await discovery.json() as { issuer?: string; revocation_endpoint?: string };
          if (!discovery.ok || config.issuer !== ISSUER || !config.revocation_endpoint || new URL(config.revocation_endpoint).origin !== ISSUER) throw new Error("Discovery inválido");
          revoked = false;
          // Revogação é idempotente: uma repetição curta só para rede/5xx, nunca para inferência.
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const response = await this.fetcher(config.revocation_endpoint, { method: "POST", signal: AbortSignal.timeout(6_000), redirect: "error",
                headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
                  token: registration.credentials.refreshToken, token_type_hint: "refresh_token", client_id: registration.clientId }) });
              revoked = response.status === 200;
              if (revoked || response.status < 500) break;
            } catch { /* Limite de duas tentativas; as credenciais locais serão removidas. */ }
            if (!attempt) await delay(250);
          }
        } catch { revoked = false; }
      }
      if (registration) registration.credentials = undefined;
      await save(data);
      return { revoked };
    });
  }

  async listModels(): Promise<ChatGPTModel[]> {
    const token = await this.accessToken();
    const response = await this.fetcher(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), redirect: "error" });
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw openAIError(response.status, value, response.headers.get("x-request-id") ?? undefined);
    if (!value || typeof value !== "object" || !("models" in value) || !Array.isArray(value.models)) throw new Error("A OpenAI retornou uma lista de modelos inválida.");
    return value.models.filter((entry): entry is { slug: string; display_name: string; visibility: string } =>
      Boolean(entry && typeof entry === "object" && entry.visibility === "list" && typeof entry.slug === "string" && typeof entry.display_name === "string"))
      .map((entry) => ({ slug: entry.slug, displayName: entry.display_name }));
  }

  private async exchange(body: URLSearchParams, previous?: Credentials): Promise<Credentials> {
    let response: Response;
    try { response = await this.fetcher(`${ISSUER}/api/accounts/oauth/token`, { method: "POST", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(15_000) }); }
    catch { throw new Error("Não foi possível conectar à autenticação ChatGPT. Tente novamente."); }
    const value = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) throw openAIError(response.status, value, response.headers.get("x-request-id") ?? undefined);
    if (!value || typeof value.access_token !== "string" || !value.access_token || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
      || typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in <= 0
      || (previous?.refreshToken && (typeof value.refresh_token !== "string" || !value.refresh_token))) {
      throw new Error("A autenticação ChatGPT retornou credenciais incompletas.");
    }
    return { accessToken: value.access_token, refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
      idToken: typeof value.id_token === "string" ? value.id_token : previous?.idToken,
      scopes: typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [],
      expiresAt: Date.now() + value.expires_in * 1000 };
  }
}

function authData(stored: ChatGPTAuthData | undefined): ChatGPTAuthData {
  if (!stored) return { version: 1, hostId: `urn:uuid:${randomUUID()}`, registrations: [] };
  if (stored.version !== 1 || typeof stored.hostId !== "string" || !stored.hostId.startsWith("urn:uuid:") || !Array.isArray(stored.registrations)) throw new Error("A sessão ChatGPT local tem um formato inválido.");
  return stored;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Reutilizado entre rotas e recompilações do servidor local.
const globalAuth = globalThis as typeof globalThis & { __gudyChatGPTAuth?: ChatGPTAuth };
export const chatGPTAuth = globalAuth.__gudyChatGPTAuth ??= new ChatGPTAuth();
