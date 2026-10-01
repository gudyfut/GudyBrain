/** A interface é local: bloqueia DNS rebinding e solicitações de outros sites. */
export function localAccessAllowed(request: Request, callback = false): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (!host || url.protocol !== "http:") return false;
    const authority = new URL(`http://${host}`);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(authority.hostname)
      || authority.username || authority.password || authority.host !== host) return false;
    const site = request.headers.get("sec-fetch-site");
    // O retorno OAuth é uma navegação externa validada por state, nonce e PKCE.
    if (!callback && site && site !== "same-origin" && site !== "none") return false;
    const origin = request.headers.get("origin");
    if (origin && origin !== authority.origin) return false;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && site && !origin) return false;
    return true;
  } catch { return false; }
}
