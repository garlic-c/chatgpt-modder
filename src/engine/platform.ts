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
  createReadStream,
} from "./native-fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Asar, type Entry } from "./asar";
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
  if (process.platform === "linux") {
    const asar = join(root, "resources/app.asar"),
      archive = await Asar.load(asar),
      pkg = JSON.parse((await archive.read("package.json")).toString());
    if (pkg.name !== "openai-codex-electron")
      throw Error("仅支持新版官方 ChatGPT 客户端");
    await linuxExecutable(root);
    return {
      root,
      version: String(pkg.version),
      asar,
      plist: null,
      platform: "linux" as const,
      // The official Linux build embeds no ASAR header hash in its ELF
      // binary (no plist, PE resource or digest slot); the adapter header
      // fingerprint and per-file integrity entries are the only anchors.
      declaredHeader: null,
    };
  }
  throw Error("目前仅提供 macOS / Windows / Linux 界面");
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
  } else if (process.platform === "linux") {
    const { stdout } = await run("/bin/ps", ["-axo", "pid=,command="], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const fragment = root + "/";
    if (stdout.split("\n").some((line) => line.includes(fragment)))
      throw Error("请先完全退出目标 ChatGPT（包括辅助进程），再应用或恢复");
  } else throw Error("不支持的操作系统");
}
export async function updateIntegrity(root: string, hash: string) {
  if (process.platform === "linux") {
    // Nothing declares the ASAR header hash outside the archive on Linux,
    // so there is no platform integrity record to rewrite. The rewritten
    // archive carries fresh per-file integrity entries instead.
    return;
  }
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
  if (process.platform === "linux") {
    // No code signature exists on Linux. The equivalent check is that the
    // staged archive is internally consistent: every integrity entry in
    // its header must match the file bytes the client will validate.
    const archive = await Asar.load(join(root, "resources/app.asar"));
    await verifyAsarIntegrity(archive);
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
async function hashEntry(archive: Asar, path: string) {
  const entry = archive.entry(path);
  if (entry.link) throw Error("不能校验 " + path);
  const hash = createHash("sha256");
  const consume = async (
    stream: ReturnType<typeof createReadStream>,
  ): Promise<string> => {
    await new Promise<void>((resolvePromise, reject) => {
      stream.on("data", (chunk) => hash.update(chunk as Buffer));
      stream.on("end", resolvePromise);
      stream.on("error", reject);
    });
    return hash.digest("hex");
  };
  if (entry.unpacked) {
    // Unpacked entries carry integrity metadata in the header, but their
    // bytes live beside the archive in app.asar.unpacked/.
    return consume(
      createReadStream(join(archive.path + ".unpacked", ...path.split("/"))),
    );
  }
  if (entry.offset == null || entry.size == null)
    throw Error("不能校验 " + path);
  if (entry.size === 0) return hash.digest("hex");
  const start = archive.dataOffset + Number(entry.offset);
  return consume(
    createReadStream(archive.path, {
      start,
      end: start + entry.size - 1,
    }),
  );
}
export async function verifyAsarIntegrity(archive: Asar) {
  const visit = async (entry: Entry, prefix = ""): Promise<void> => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.files) await visit(child, path);
      else if (child.integrity) {
        if (child.integrity.algorithm !== "SHA256")
          throw Error("未知的 ASAR 完整性算法：" + path);
        if ((await hashEntry(archive, path)) !== child.integrity.hash)
          throw Error("ASAR 文件完整性校验不一致：" + path);
      }
    }
  };
  await visit(archive.header);
}
export async function linuxExecutable(root: string) {
  const path = join(root, "ChatGPT");
  if (await exists(path)) return path;
  throw Error("找不到已知的 Linux ChatGPT 主程序");
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
  if (
    process.platform === "linux" &&
    /^\/(usr\/(lib|share|local\/lib)|opt)\//.test(root + "/")
  )
    throw Error(
      "这是系统目录中的官方安装；当前版本仅支持诊断，不能直接修改。请导出兼容诊断。",
    );
}
