import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { homedir } from "node:os";
import { run } from "./platform";

export type DiscoveryReport = {
  query?: { milliseconds: number; error?: string };
  candidates: {
    path: string;
    source: "preferred" | "common" | "store";
    stage?: string;
    error?: string;
  }[];
  manifestErrors?: string[];
};
export const discoveryError = (error: unknown) => {
  const e = (error ?? {}) as { code?: string | number; message?: string };
  return `${e.code ? String(e.code) + ": " : ""}${e.message ?? String(error)}`;
};

export const storeDiscoveryScript = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$paths = @()
$manifestErrors = @()
Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI[.].*(ChatGPT|Codex|Desktop)' } | Sort-Object Version -Descending | ForEach-Object {
  $pkg = $_
  $root = $pkg.InstallLocation
  if ($root) {
    try {
      $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
      foreach ($entry in $manifest.Package.Applications.Application) {
        if ($entry.Executable) {
          $exe = [IO.Path]::GetFullPath([IO.Path]::Combine($root, [string]$entry.Executable))
          if ($exe.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            $paths += [IO.Path]::GetDirectoryName($exe)
          }
        }
      }
    } catch { $manifestErrors += ($pkg.PackageFullName + ': ' + $_.Exception.Message) }
    $paths += $root
    $paths += [IO.Path]::Combine($root, 'app')
  }
}
ConvertTo-Json -InputObject @{ paths = @($paths | Select-Object -Unique); manifestErrors = @($manifestErrors) } -Compress
`;
export function storeLocations(stdout: string): string[] {
  const parsed = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]");
  const value: unknown =
    parsed && !Array.isArray(parsed) && typeof parsed === "object"
      ? parsed.paths
      : parsed;
  return [
    ...new Set(
      (Array.isArray(value) ? value : [value]).filter(
        (v): v is string =>
          typeof v === "string" &&
          !!v &&
          !v.includes("\0") &&
          win32.isAbsolute(v),
      ),
    ),
  ];
}

export async function clientCandidates(
  platform = process.platform,
  preferred?: string,
  env = process.env,
  home = homedir(),
  report?: DiscoveryReport,
) {
  const paths: string[] = preferred ? [preferred] : [];
  if (platform === "darwin")
    paths.push(
      "/Applications/ChatGPT.app",
      posix.join(home, "Applications/ChatGPT.app"),
    );
  if (platform === "linux") paths.push("/usr/lib/chatgpt");
  if (platform === "win32") {
    for (const base of [
      env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs"),
      env.LOCALAPPDATA,
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
    ]) {
      if (base)
        for (const name of [
          "ChatGPT",
          "OpenAI/ChatGPT",
          "OpenAI ChatGPT",
          "chatgpt",
        ])
          paths.push(win32.join(base, name));
    }
    const started = Date.now();
    let storePaths: string[] = [];
    try {
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", storeDiscoveryScript],
        { timeout: 8000, maxBuffer: 1024 * 1024 },
      );
      storePaths = storeLocations(stdout);
      paths.push(...storePaths);
      const payload = JSON.parse(stdout.replace(/^\uFEFF/, "").trim() || "[]");
      if (report)
        report.manifestErrors = Array.isArray(payload?.manifestErrors)
          ? payload.manifestErrors.filter((e: unknown) => typeof e === "string")
          : [];
      if (report) report.query = { milliseconds: Date.now() - started };
    } catch (error) {
      if (report)
        report.query = {
          milliseconds: Date.now() - started,
          error: discoveryError(error),
        };
    }
    if (report)
      report.candidates = [...new Set(paths)].map((path) => ({
        path,
        source: storePaths.includes(path)
          ? "store"
          : path === preferred
            ? "preferred"
            : "common",
      }));
  }
  if (report && platform !== "win32")
    report.candidates = [...new Set(paths)].map((path) => ({
      path,
      source: path === preferred ? "preferred" : "common",
    }));
  return [...new Set(paths)];
}

// Prefer a usable client, but still report an installed unsupported/protected one.
export async function discoverClient<T extends { compatible: boolean }>(
  candidates: string[],
  inspect: (path: string) => Promise<T>,
  report?: DiscoveryReport,
) {
  let fallback: { path: string; inspection: T | null; error?: string } | null =
    null;
  for (const path of candidates) {
    const record = report?.candidates.find((c) => c.path === path);
    try {
      await access(path);
      if (!(await stat(path)).isDirectory()) {
        if (record) record.stage = "not-directory";
        continue;
      }
    } catch (error) {
      if (record) {
        record.stage = "access";
        record.error = discoveryError(error);
      }
      // A manifest path is installation evidence even when its directory is unreadable.
      if (
        record?.source === "store" &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        fallback ??= {
          path,
          inspection: null,
          error: `已定位，但无法读取客户端：${discoveryError(error)}`,
        };
      continue;
    }
    try {
      const inspection = await inspect(path);
      if (record)
        record.stage = inspection.compatible ? "compatible" : "unsupported";
      if (inspection.compatible) return { path, inspection };
      fallback ??= { path, inspection };
    } catch (error) {
      if (record) {
        record.stage = "inspect";
        record.error = discoveryError(error);
      }
      if (record?.source === "store")
        fallback ??= {
          path,
          inspection: null,
          error: `已定位，但客户端检查未通过：${discoveryError(error)}`,
        };
    }
  }
  return fallback;
}
