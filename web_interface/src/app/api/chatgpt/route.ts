import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { chatGPTAuth } from "@gudybrain/core/chatgpt-auth";
import { diagnoseResponses } from "@gudybrain/core/responses-diagnostic";
import { assertLocalRequest, localRequestUrl, chatGPTSnapshot, chooseChatGPTModel } from "../../../server/chatgpt";
import { apiError } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    assertLocalRequest(request);
    const loginError = request.cookies.get("gudy-chatgpt-login-error")?.value;
    const response = NextResponse.json({ ...await chatGPTSnapshot(), loginError: loginError ? decodeURIComponent(loginError) : undefined }, { headers: noStore });
    response.cookies.delete("gudy-chatgpt-login-error");
    return response;
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertLocalRequest(request, true);
    const content = await request.text();
    if (content.length > 2000) throw new Error("Solicitação de conta inválida.");
    const body = (request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(content)) : JSON.parse(content)) as { action?: string; accountId?: string; model?: string; mode?: string };
    if (body.accountId !== undefined && (typeof body.accountId !== "string" || body.accountId.length > 100)) throw new Error("Conta inválida.");
    if (body.action === "signin") {
      const browserId = randomUUID();
      const callback = new URL("/auth/callback", localRequestUrl(request).origin).toString();
      const authorizationUrl = await chatGPTAuth.beginSignIn(callback, browserId, body.accountId);
      // O ID-token hint, quando usado, só aparece na navegação HTTP; nunca em JSON para o cliente.
      const response = NextResponse.redirect(authorizationUrl, 303);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.cookies.set("gudy-chatgpt-oauth", browserId, { httpOnly: true, sameSite: "lax", path: "/auth/callback", maxAge: 600 });
      return response;
    }
    if (body.action === "models") return NextResponse.json({ models: await chatGPTAuth.listModels() }, { headers: noStore });
    if (body.action === "diagnose") {
      await chatGPTSnapshot();
      return NextResponse.json(await diagnoseResponses(body.mode === "structured", request.signal), { headers: noStore });
    }
    if (body.action === "select" && body.accountId) await chatGPTAuth.selectAccount(body.accountId);
    else if (body.action === "cancel") chatGPTAuth.cancelSignIns();
    else if (body.action === "signout") {
      const { revoked } = await chatGPTAuth.signOut();
      return NextResponse.json({ ...await chatGPTSnapshot(), notice: revoked ? "Conta desconectada deste aplicativo."
        : "Conta desconectada localmente. Não foi possível confirmar a revogação remota; desconecte o Gudman nas configurações do ChatGPT." }, { headers: noStore });
    } else if (body.action === "model" && typeof body.model === "string" && body.model.length <= 100) await chooseChatGPTModel(body.model);
    else throw new Error("Operação ChatGPT inválida.");
    return NextResponse.json(await chatGPTSnapshot(), { headers: noStore });
  } catch (error) { return apiError(error); }
}
