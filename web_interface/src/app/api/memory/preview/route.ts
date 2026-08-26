import { NextResponse } from "next/server";
import { apiError } from "../../../../server/http";
import { previewMemoryChange } from "../../../../server/memory";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as {
      action?: "criar" | "atualizar";
      origin?: string;
      frontmatter?: Record<string, unknown>;
      body?: string;
    };
    if (!body.action || !["criar", "atualizar"].includes(body.action)
      || !body.frontmatter || typeof body.frontmatter !== "object"
      || Array.isArray(body.frontmatter) || typeof body.body !== "string") {
      throw new Error("Dados insuficientes para montar a comparação.");
    }
    if (body.action === "atualizar" && !body.origin) {
      throw new Error("Informe o arquivo existente para comparar a atualização.");
    }
    return NextResponse.json(previewMemoryChange({
      action: body.action,
      origin: body.origin,
      frontmatter: body.frontmatter,
      body: body.body,
    }));
  } catch (error) {
    return apiError(error);
  }
}
