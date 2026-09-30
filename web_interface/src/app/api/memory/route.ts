import { NextResponse } from "next/server";
import { apiError } from "../../../server/http";
import { listMemories, readMemory, updateMemoryDocument } from "../../../server/memory";

export const runtime = "nodejs";

export function GET(request: Request): NextResponse {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (path) return NextResponse.json(readMemory(path));
    return NextResponse.json({
      items: listMemories(url.searchParams.get("q") ?? "", url.searchParams.get("type") ?? ""),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { path?: string; content?: string; revision?: string };
    if (!body.path || typeof body.content !== "string" || typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
      throw new Error("Informe caminho, conteúdo integral e revisão-base da memória. Recarregue o editor se necessário.");
    }
    return NextResponse.json(await updateMemoryDocument(body.path, body.content, body.revision));
  } catch (error) {
    return apiError(error);
  }
}
