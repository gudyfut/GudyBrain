import "server-only";

import { existsSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DISCORD_ROOT, resolveSessionDir } from "./paths";

export type CallJobKind = "transcrever" | "analisar";
export type JobStatus = "na_fila" | "executando" | "concluido" | "erro";

export interface CallJob {
  readonly id: string;
  readonly kind: CallJobKind;
  readonly sessionId: string;
  readonly force: boolean;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  logs: string[];
  error: string | null;
}

interface JobRuntime {
  readonly jobs: Map<string, CallJob>;
  readonly queue: string[];
  active: ChildProcessWithoutNullStreams | null;
}

const globalRuntime = globalThis as typeof globalThis & { __gudyCallJobs?: JobRuntime };
const runtime: JobRuntime = globalRuntime.__gudyCallJobs ?? {
  jobs: new Map(),
  queue: [],
  active: null,
};
globalRuntime.__gudyCallJobs = runtime;

export function enqueueCallJob(
  kind: CallJobKind,
  sessionId: string,
  force = false,
): CallJob {
  resolveSessionDir(sessionId);
  const duplicate = [...runtime.jobs.values()].find(
    (job) => job.kind === kind && job.sessionId === sessionId
      && (job.status === "na_fila" || job.status === "executando"),
  );
  if (duplicate) return duplicate;
  const job: CallJob = {
    id: randomUUID(),
    kind,
    sessionId,
    force,
    status: "na_fila",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    logs: [],
    error: null,
  };
  runtime.jobs.set(job.id, job);
  runtime.queue.push(job.id);
  void runNext();
  return job;
}

export function listCallJobs(): CallJob[] {
  return [...runtime.jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map(copyJob);
}

export function getCallJob(id: string): CallJob | null {
  const job = runtime.jobs.get(id);
  return job ? copyJob(job) : null;
}

async function runNext(): Promise<void> {
  if (runtime.active) return;
  const id = runtime.queue.shift();
  if (!id) return;
  const job = runtime.jobs.get(id);
  if (!job) return void runNext();

  job.status = "executando";
  job.startedAt = new Date().toISOString();
  const python = pythonExecutable();
  const session = resolveSessionDir(job.sessionId);
  const args = ["-m", "gudybot", job.kind, session];
  if (job.kind === "analisar" && job.force) args.push("--forcar");
  const child = spawn(python, args, {
    cwd: DISCORD_ROOT,
    env: process.env,
    windowsHide: true,
  });
  runtime.active = child;
  console.info(`[web/${job.kind}] sessão ${job.sessionId} iniciada`);
  capture(child.stdout, job, false);
  capture(child.stderr, job, true);

  child.on("error", (error) => {
    finish(job, false, error.message);
  });
  child.on("close", (code) => {
    finish(job, code === 0, code === 0 ? null : `Processo terminou com código ${code ?? "?"}.`);
  });
}

function finish(job: CallJob, success: boolean, error: string | null): void {
  if (job.endedAt) return;
  job.status = success ? "concluido" : "erro";
  job.error = error;
  job.endedAt = new Date().toISOString();
  runtime.active = null;
  console.info(`[web/${job.kind}] sessão ${job.sessionId}: ${job.status}`);
  void runNext();
}

function capture(stream: NodeJS.ReadableStream, job: CallJob, isError: boolean): void {
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      job.logs.push(line);
      if (job.logs.length > 200) job.logs.shift();
      (isError ? console.error : console.info)(`[web/${job.kind}] ${line}`);
    }
  });
}

function pythonExecutable(): string {
  const local = join(DISCORD_ROOT, ".venv", "Scripts", "python.exe");
  return existsSync(local) ? local : "python";
}

function copyJob(job: CallJob): CallJob {
  return { ...job, logs: [...job.logs] };
}
