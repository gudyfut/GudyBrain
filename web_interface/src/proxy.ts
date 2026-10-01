import { NextResponse, type NextRequest } from "next/server";
import { localAccessAllowed } from "./server/local-access";

export function proxy(request: NextRequest) {
  if (!localAccessAllowed(request, request.nextUrl.pathname === "/auth/callback")) {
    return NextResponse.json({ error: "A interface exige acesso local e origem autorizada." }, { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export const config = { matcher: ["/api/:path*", "/auth/callback"] };
