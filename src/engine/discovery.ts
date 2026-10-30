import { access, stat } from "node:fs/promises";
import { join, win32 } from "node:path";
import { homedir } from "node:os";
import { run } from "./platform";

export const storeDiscoveryScript = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$paths = @()
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
    } catch {}
    $paths += $root
    $paths += [IO.Path]::Combine($root, 'app')
  }
}
ConvertTo-Json -InputObject @($paths | Select-Object -Unique) -Compress
`;
export function storeLocations(stdout: string): string[] {
  const value: unknown = JSON.parse(
    stdout.replace(/^\uFEFF/, "").trim() || "[]",
  );
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
) {
  const paths: string[] = preferred ? [preferred] : [];
  if (platform === "darwin")
    paths.push(
      "/Applications/ChatGPT.app",
      join(home, "Applications/ChatGPT.app"),
    );
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
    try {
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", storeDiscoveryScript],
        { timeout: 8000, maxBuffer: 1024 * 1024 },
      );
      paths.push(...storeLocations(stdout));
    } catch {
      /* Common installation directories remain available without PowerShell. */
    }
  }
  return [...new Set(paths)];
}

// Prefer a usable client, but still report an installed unsupported/protected one.
export async function discoverClient<T extends { compatible: boolean }>(
  candidates: string[],
  inspect: (path: string) => Promise<T>,
) {
  let fallback: { path: string; inspection: T | null; error?: string } | null =
    null;
  for (const path of candidates) {
    try {
      await access(path);
      if (!(await stat(path)).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const inspection = await inspect(path);
      if (inspection.compatible) return { path, inspection };
      fallback ??= { path, inspection };
    } catch {
      /* A leftover directory is not evidence of an installed client. */
    }
  }
  return fallback;
}
