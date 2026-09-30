import { NextResponse } from "next/server";
import { MemoryBrowser } from "@gudybrain/tools/memoria/navegador";
import { buildMemoryIndex } from "@gudybrain/tools/memoria/indice-contexto";
import { resolveProjectPath } from "@gudybrain/core/project-root";
import { apiError } from "../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  try {
    const index = buildMemoryIndex(new MemoryBrowser(resolveProjectPath("memory")));
    return NextResponse.json({ nodes: index.nodes, chars: index.chars }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
