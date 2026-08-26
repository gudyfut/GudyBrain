import { NextResponse } from "next/server";
import { botAction, botStatus, startBot, stopBot } from "../../../server/bot-process";
import { apiError } from "../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await botStatus());
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { action?: string };
    if (body.action === "iniciar") return NextResponse.json(startBot());
    if (body.action === "desligar") return NextResponse.json(stopBot());
    if (["entrar", "gravar", "parar", "sair"].includes(body.action ?? "")) {
      return NextResponse.json(await botAction(body.action as "entrar" | "gravar" | "parar" | "sair"));
    }
    throw new Error("Ação do bot inválida.");
  } catch (error) {
    return apiError(error);
  }
}
