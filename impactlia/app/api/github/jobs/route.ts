import crypto from "node:crypto";
import { processDueAnalyses } from "@/lib/automation/run";
import { automation } from "@/lib/env";

// The retry sweep, called by Vercel Cron every minute (vercel.json). Starts
// jobs whose retry is due and recovers attempts that stopped without
// finishing. Public to the proxy, so it checks Vercel's bearer secret itself.

export const maxDuration = 300;

function authorised(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export async function GET(request: Request): Promise<Response> {
  const config = automation.config;
  if (!config) return Response.json({ error: "Automatic analysis is not set up." }, { status: 503 });
  if (!authorised(request.headers.get("authorization"), config.cronSecret)) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }
  try {
    const started = await processDueAnalyses(config);
    return Response.json({ started });
  } catch (error) {
    console.error("The automatic analysis sweep failed:", error);
    return Response.json({ error: "The sweep failed." }, { status: 500 });
  }
}
