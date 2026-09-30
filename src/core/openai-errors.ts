export class OpenAIRequestError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId?: string) {
    const messages: Record<string, string> = {
      subscription_sharing_usage_limit_exceeded: "O limite do plano ChatGPT ou o limite atribuído ao Gudman foi atingido. Confira Configurações → Uso no ChatGPT.",
      subscription_sharing_usage_unavailable: "Não foi possível verificar a cota ChatGPT. Tente novamente mais tarde.",
      subscription_sharing_user_not_eligible: "A conta ou o workspace não está habilitado para usar o plano ChatGPT neste aplicativo.",
      subscription_sharing_unsupported_capability: "O modelo ou um recurso solicitado não está disponível pelo plano ChatGPT.",
      subscription_sharing_route_not_supported: "A operação solicitada não está disponível pelo plano ChatGPT.",
      invalid_grant: "A autorização ChatGPT expirou ou foi revogada. Conecte a conta novamente em Configurações.",
      invalid_refresh_token: "A sessão ChatGPT expirou. Conecte a conta novamente em Configurações.",
      model_not_found: "O modelo configurado não está disponível para esta conta. Confira os modelos em Configurações.",
    };
    const fallback = status === 401 ? "A autenticação ChatGPT não foi aceita. Conecte a conta novamente em Configurações."
      : status === 403 ? "A conta, o workspace ou a região não autorizou esta operação. Confira a conexão ChatGPT."
      : status === 429 ? "O limite de uso da OpenAI foi atingido. Confira o uso do plano e tente novamente mais tarde."
      : status >= 500 ? "A OpenAI está temporariamente indisponível. Tente novamente mais tarde."
      : "A OpenAI não aceitou a requisição. Confira o modelo e a conexão ChatGPT em Configurações.";
    super(`${messages[code] ?? fallback} [HTTP ${status}; ${code}${requestId ? `; ${requestId}` : ""}]`);
    this.name = "OpenAIRequestError";
  }
}

export function openAIError(status: number, value: unknown, requestId?: string): OpenAIRequestError {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : record;
  const candidate = typeof record.error === "string" ? record.error : error.code;
  const code = typeof candidate === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(candidate) ? candidate : "request_failed";
  const safeId = requestId && /^[a-zA-Z0-9_.-]{1,150}$/.test(requestId) ? requestId : undefined;
  return new OpenAIRequestError(status, code, safeId);
}
