import { NextResponse, type NextRequest } from "next/server";
import { chatGPTAuth } from "@gudybrain/core/chatgpt-auth";
import { localRequestUrl } from "../../../server/chatgpt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  let url: URL;
  try { url = localRequestUrl(request); }
  catch { return new NextResponse("Callback local obrigatório.", { status: 403 }); }
  let result = "connected";
  let message: string | undefined;
  try { await chatGPTAuth.completeSignIn(url, request.cookies.get("gudy-chatgpt-oauth")?.value ?? ""); }
  catch (error) { result = "failed"; message = error instanceof Error ? error.message : "Não foi possível concluir a conexão ChatGPT."; }
  // Remove código/state da barra de endereço; nenhum dado da conta vai para a URL de retorno.
  const response = NextResponse.redirect(new URL(`/settings?chatgpt=${result}`, url.origin), 303);
  response.cookies.set("gudy-chatgpt-oauth", "", { httpOnly: true, sameSite: "lax", path: "/auth/callback", maxAge: 0 });
  if (message) response.cookies.set("gudy-chatgpt-login-error", encodeURIComponent(message.slice(0, 1000)), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 120 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
