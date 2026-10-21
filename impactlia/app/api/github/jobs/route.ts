import crypto from "node:crypto";
import { after } from "next/server";
import { listDueAnalyses, processAutomaticAnalysis } from "@/lib/automation/run";
import { automation } from "@/lib/env";

// The retry sweep. Starts jobs whose retry is due and recovers attempts that
// stopped without finishing. Called every half hour by the GitHub Actions
// workflow in .github/workflows, once a day by Vercel Cron as a backstop
// (the Hobby plan allows no more), and by a finished job to start the next.
// Public to the proxy, so it checks the bearer secret itself.
//
// It answers as soon as it knows what is due and runs the jobs after the
// response, so a caller is never kept waiting for an analysis.

// The jobs started after the response share this function's time.
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
    const due = await listDueAnalyses(config);
    after(() => Promise.all(due.map((jobId) => processAutomaticAnalysis(config, jobId))));
    return Response.json({ started: due.length });
  } catch (error) {
    console.error("The automatic analysis sweep failed:", error);
    return Response.json({ error: "The sweep failed." }, { status: 500 });
  }
}
