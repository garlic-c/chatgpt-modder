import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  lstat,
  realpath,
  mkdtemp,
  rm,
  readdir,
} from "./native-fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Asar } from "./asar";
import { exists } from "./files";
import { peHeaderHash, rewritePeHeaderHash } from "./windows-pe";
import { rewriteMacDigest } from "./mac-digest";
export const run = promisify(execFile);
export async function clientInfo(input: string) {
  const root = await realpath(resolve(input));
  if (!(await lstat(root)).isDirectory()) throw Error("请选择客户端应用目录");
  if (process.platform === "darwin") {
    if (!root.endsWith(".app")) throw Error("请选择 ChatGPT.app");
    const plist = join(root, "Contents/Info.plist");
    const { stdout } = await run("/usr/bin/plutil", [
      "-convert",
      "json",
      "-o",
      "-",
      plist,
    ]);
    const info = JSON.parse(stdout);
    if (info.CFBundleIdentifier !== "com.openai.codex")
      throw Error("仅支持新版官方 ChatGPT 客户端");
    return {
      root,
      version: String(info.CFBundleShortVersionString),
      asar: join(root, "Contents/Resources/app.asar"),
      plist,
      platform: "darwin" as const,
      declaredHeader: info.ElectronAsarIntegrity?.["Resources/app.asar"]?.hash,
    };
  }
  if (process.platform === "win32") {
    const asar = join(root, "resources/app.asar"),
      archive = await Asar.load(asar),
      pkg = JSON.parse((await archive.read("package.json")).toString());
    if (pkg.name !== "openai-codex-electron")
      throw Error("仅支持新版官方 ChatGPT 客户端");
    const executable = await windowsExecutable(root);
    return {
      root,
      version: String(pkg.version),
      asar,
      plist: null,
      platform: "win32" as const,
      declaredHeader: peHeaderHash(await readFile(executable)),
    };
  }
  throw Error("目前仅提供 macOS / Windows 界面");
}
export async function assertStopped(root: string) {
  if (process.platform === "darwin") {
    const { stdout } = await run("/bin/ps", ["-axo", "pid=,command="], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const fragments = [
      root + "/Contents/MacOS/",
      root + "/Contents/Frameworks/",
    ];
    if (
      stdout.split("\n").some((line) => fragments.some((f) => line.includes(f)))
    )
      throw Error("请先完全退出目标 ChatGPT（包括辅助进程），再应用或恢复");
  } else if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ExecutablePath | ConvertTo-Json -Compress",
    ]);
    const list = JSON.parse(stdout || "[]");
    if (
      (Array.isArray(list) ? list : [list]).some(
        (x) =>
          typeof x.ExecutablePath === "string" &&
          x.ExecutablePath.toLowerCase().startsWith(root.toLowerCase() + "\\"),
      )
    )
      throw Error("请先完全退出目标 ChatGPT");
  } else throw Error("不支持的操作系统");
}
export async function updateIntegrity(root: string, hash: string) {
  if (process.platform === "win32") {
    const path = await windowsExecutable(root);
    await writeFile(path, rewritePeHeaderHash(await readFile(path), hash));
    return;
  }
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`,
    join(root, "Contents/Info.plist"),
  ]);
  const { stdout } = await run("/usr/bin/plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    join(root, "Contents/Info.plist"),
  ]);
  const framework = await realpath(
    join(root, "Contents/Frameworks/Codex Framework.framework/Codex Framework"),
  );
  await writeFile(
    framework,
    rewriteMacDigest(
      await readFile(framework),
      JSON.parse(stdout).ElectronAsarIntegrity,
    ),
  );
}
export async function signAndVerify(root: string) {
  if (process.platform === "win32") {
    const archive = await Asar.load(join(root, "resources/app.asar"));
    if (
      peHeaderHash(await readFile(await windowsExecutable(root))) !==
      archive.headerHash
    )
      throw Error("Windows ASAR 与可执行文件校验不一致");
    return;
  }
  // Finder/file-provider metadata can appear on copied bundles and is forbidden by codesign.
  // Remove only the two signing-incompatible attributes, never login data or all xattrs.
  for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
    try {
      await run("/usr/bin/xattr", ["-dr", attribute, root], {
        maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? "";
      if (!stderr.includes("No such xattr")) throw error;
    }
  }
  // A local signature cannot claim OpenAI's restricted team/keychain/notification grants.
  const temporary = await mkdtemp(join(tmpdir(), "cgm-entitlements-"));
  try {
    const source = join(temporary, "source.plist"),
      safe = join(temporary, "local.plist");
    const signLocal = async (path: string) => {
      const { stdout } = await run(
        "/usr/bin/codesign",
        ["-d", "--entitlements", ":-", path],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      let grants: Record<string, unknown> = {};
      if (stdout.trim()) {
        await writeFile(source, stdout);
        const converted = await run("/usr/bin/plutil", [
          "-convert",
          "json",
          "-o",
          "-",
          source,
        ]);
        grants = JSON.parse(converted.stdout);
      }
      await writeFile(safe, JSON.stringify(localEntitlements(grants)));
      await run("/usr/bin/plutil", ["-convert", "xml1", safe]);
      await run(
        "/usr/bin/codesign",
        [
          "--force",
          "--sign",
          "-",
          "--options",
          "runtime",
          "--entitlements",
          safe,
          path,
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      );
    };
    const framework = join(
        root,
        "Contents/Frameworks/Codex Framework.framework",
      ),
      helpers = join(framework, "Versions/Current/Helpers");
    for (const name of (await readdir(helpers))
      .filter((n) => n.endsWith(".app"))
      .sort())
      await signLocal(join(helpers, name));
    await run("/usr/bin/codesign", ["--force", "--sign", "-", framework], {
      maxBuffer: 4 * 1024 * 1024,
    });
    await signLocal(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", root], {
    maxBuffer: 4 * 1024 * 1024,
  });
}
export function localEntitlements(grants: Record<string, unknown>) {
  return {
    ...Object.fromEntries(
      Object.entries(grants).filter(
        ([key]) =>
          !key.startsWith("com.apple.developer.") &&
          ![
            "com.apple.application-identifier",
            "application-identifier",
            "keychain-access-groups",
            "com.apple.security.application-groups",
          ].includes(key),
      ),
    ),
    "com.apple.security.cs.disable-library-validation": true,
  };
}
export async function windowsExecutable(root: string) {
  for (const name of ["ChatGPT.exe", "Codex.exe", "codex.exe"]) {
    const path = join(root, name);
    if (await exists(path)) return path;
  }
  throw Error("找不到已知的 Windows ChatGPT 主程序");
}
export async function assertMutableInstallation(root: string) {
  if (
    process.platform === "win32" &&
    (/\\WindowsApps\\/i.test(root) ||
      (await exists(join(root, "AppxManifest.xml"))) ||
      (await exists(join(root, "..", "AppxManifest.xml"))))
  )
    throw Error(
      "这是受保护的商店安装包；当前版本仅支持诊断，不能直接修改。请导出兼容诊断。",
    );
}
