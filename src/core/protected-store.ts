import { spawn } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export interface AuthStore<T> {
  transaction<R>(task: (value: T | undefined, save: (next: T) => Promise<void>) => Promise<R>): Promise<R>;
}

/** Fora do projeto. Windows: DPAPI CurrentUser; Unix: diretório 0700/arquivo 0600. */
export function chatGPTStorageDirectory(): string {
  return process.platform === "win32"
    ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "GudyBrain", "chatgpt")
    : join(homedir(), ".config", "gudybrain", "chatgpt");
}

export class ProtectedAuthStore<T> implements AuthStore<T> {
  constructor(private readonly directory = chatGPTStorageDirectory()) {}

  async transaction<R>(task: (value: T | undefined, save: (next: T) => Promise<void>) => Promise<R>): Promise<R> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(this.directory, 0o700);
    const lockPath = join(this.directory, "session.lock");
    const started = Date.now();
    // Também serializa refreshes entre a aplicação web e diagnósticos em outro processo.
    let lock;
    while (!lock) {
      try { lock = await open(lockPath, "wx", 0o600); }
      catch (error) {
        if (!hasCode(error, "EEXIST")) throw new Error("Não foi possível proteger a sessão ChatGPT local.");
        const info = await stat(lockPath).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > 120_000) await rm(lockPath, { force: true });
        if (Date.now() - started > 35_000) throw new Error("A sessão ChatGPT está ocupada. Tente novamente.");
        await delay(50);
      }
    }
    const path = join(this.directory, "accounts.dat");
    try {
      let value: T | undefined;
      try {
        const stored = await readFile(path, "utf8");
        value = JSON.parse(process.platform === "win32" ? await dpapi(stored, false) : stored) as T;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw new Error("Não foi possível abrir a sessão ChatGPT protegida.");
      }
      return await task(value, async (next) => {
        const content = JSON.stringify(next);
        const protectedContent = process.platform === "win32" ? await dpapi(content, true) : content;
        const temporary = join(this.directory, `${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, protectedContent, { mode: 0o600, flag: "wx" });
          await rename(temporary, path);
        } finally { await rm(temporary, { force: true }); }
      });
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function dpapi(input: string, protect: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    // Script fixo; credenciais apenas em stdin, nunca em argumentos ou logs.
    const script = `$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); `
      + (protect
        ? "$b=[Text.Encoding]::UTF8.GetBytes($s); $r=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))"
        : "$b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($r))");
    const child = spawn(join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new Error("Não foi possível proteger as credenciais ChatGPT com o Windows.")); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; if (output.length > 1_000_000) { child.kill(); fail(); } });
    child.stderr.on("data", () => { /* Saídas potencialmente sensíveis nunca são registradas. */ });
    child.stdin.on("error", fail);
    child.on("error", fail);
    child.on("close", (code) => { clearTimeout(timer); if (code !== 0 || !output) fail(); else if (!settled) { settled = true; resolve(output); } });
    child.stdin.end(input);
  });
}
