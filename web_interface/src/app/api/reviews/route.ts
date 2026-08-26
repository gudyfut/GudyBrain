import { NextResponse } from "next/server";
import { apiError } from "../../../server/http";
import { createReview, getReview, listReviews } from "../../../server/curation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ reviews: listReviews() });
  const review = getReview(id);
  return review ? NextResponse.json(review) : NextResponse.json({ error: "Revisão não encontrada." }, { status: 404 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { kind?: "chat" | "call"; id?: string };
    if (!body.id || (body.kind !== "chat" && body.kind !== "call")) {
      throw new Error("Fonte da revisão inválida.");
    }
    return NextResponse.json(createReview({ kind: body.kind, id: body.id }), { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
