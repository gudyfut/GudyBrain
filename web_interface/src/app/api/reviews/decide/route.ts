import { NextResponse } from "next/server";
import { decideCandidate } from "../../../../server/curation";
import { apiError } from "../../../../server/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as Parameters<typeof decideCandidate>[0];
    if (!body.reviewId || !body.candidateId || !["aprovar", "rejeitar"].includes(body.decision)) {
      throw new Error("Decisão inválida.");
    }
    return NextResponse.json(await decideCandidate(body));
  } catch (error) {
    return apiError(error);
  }
}
