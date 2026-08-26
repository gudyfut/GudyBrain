import { NextResponse } from "next/server";
import { enqueueCallJob, getCallJob, listCallJobs, type CallJobKind } from "../../../../server/jobs";
import { apiError } from "../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): NextResponse {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ jobs: listCallJobs() });
  const job = getCallJob(id);
  return job ? NextResponse.json(job) : NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json() as { kind?: CallJobKind; sessionId?: string; force?: boolean };
    if (!body.sessionId || !body.kind || !["transcrever", "analisar"].includes(body.kind)) {
      throw new Error("Tarefa inválida.");
    }
    return NextResponse.json(
      enqueueCallJob(body.kind, body.sessionId, body.kind === "analisar" && body.force === true),
      { status: 202 },
    );
  } catch (error) {
    return apiError(error);
  }
}
