import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolveTrack } from "../../../../server/calls";

export const runtime = "nodejs";

export function GET(request: Request): Response {
  try {
    const url = new URL(request.url);
    const session = url.searchParams.get("session") ?? "";
    const track = url.searchParams.get("track") ?? "";
    const path = resolveTrack(session, track);
    const size = statSync(path).size;
    const range = request.headers.get("range");
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match?.[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        status = 206;
      }
    }
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    const headers = new Headers({
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Cache-Control": "private, max-age=3600",
    });
    if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    return new Response(stream, { status, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
