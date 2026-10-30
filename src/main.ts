import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  nativeTheme,
  nativeImage,
  shell,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile, readFile } from "node:fs/promises";
import { Engine } from "./engine/engine";
import { builtInModules } from "./modules/quota";
import {
  clientCandidates,
  discoverClient,
  discoveryError,
  type DiscoveryReport,
} from "./engine/discovery";
import { icnsPng } from "./engine/icons";
import { windowsExecutable, assertStopped } from "./engine/platform";
import { WindowsCopy } from "./engine/windows-copy";
let win: BrowserWindow | null = null,
  busy = false;
const uiPath = join(__dirname, "ui/index.html");
const page = pathToFileURL(uiPath).href;
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame?.url !== page
  )
    throw Error("无效的请求来源");
}
function pathArg(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 4096 ||
    path.includes("\0")
  )
    throw Error("无效的客户端路径");
}
app.setName("ChatGPT Modder");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app.whenReady().then(() => {
    const engine = new Engine(
      join(app.getPath("userData"), "backups"),
      (message) => win?.webContents.send("operation-log", message),
    );
    const copies = new WindowsCopy(join(app.getPath("userData"), "clients"));
    const log = (message: string) =>
      win?.webContents.send("operation-log", message);
    const preferenceFile = join(app.getPath("userData"), "client.json");
    let discovery: DiscoveryReport = { candidates: [] };
    const inspectClient = async (path: string) => {
      let state = await engine.inspect(path);
      if (
        process.platform === "win32" &&
        state.status === "protected" &&
        state.patchCompatible
      ) {
        const existing = await copies.existing(path);
        if (existing) {
          path = existing;
          state = await engine.inspect(existing);
        } else
          state = {
            ...state,
            compatible: true,
            status: "store-copy",
            message:
              "商店版：应用时创建本地副本，请从新快捷方式启动；可能需要重新登录。",
          };
      }
      if (
        process.platform === "win32" &&
        path.startsWith(copies.storage) &&
        state.compatible
      )
        state = {
          ...state,
          status: "user-copy",
          message:
            "本地副本：请从桌面 ChatGPT（Modder）启动，官方快捷方式保持原样。",
        };
      let icon: string | undefined;
      if (process.platform === "darwin") {
        try {
          const png = icnsPng(
            await readFile(join(path, "Contents/Resources/icon-chatgpt.icns")),
          );
          if (png) {
            const image = nativeImage.createFromBuffer(png);
            if (!image.isEmpty())
              icon = image.resize({ width: 36, height: 36 }).toDataURL();
          }
        } catch {}
      }
      if (!icon)
        try {
          icon = (
            await app.getFileIcon(
              process.platform === "win32"
                ? await windowsExecutable(path)
                : path,
              { size: "small" },
            )
          ).toDataURL();
        } catch {}
      return { ...state, icon };
    };
    ipcMain.handle("detect", async (event) => {
      trusted(event);
      if (busy) throw Error("操作尚未完成");
      let preferred: string | undefined;
      try {
        const saved = JSON.parse(await readFile(preferenceFile, "utf8"));
        pathArg(saved.path);
        preferred = saved.path;
      } catch {}
      const managed =
        process.platform === "win32" && preferred?.startsWith(copies.storage);
      discovery = { candidates: [] };
      const candidates = await clientCandidates(
        process.platform,
        managed ? undefined : preferred,
        process.env,
        app.getPath("home"),
        discovery,
      );
      const found = await discoverClient(candidates, inspectClient, discovery);
      if (found) return found;
      if (discovery.query?.error)
        log(`安装包查询失败：${discovery.query.error}`);
      return managed && preferred && !discovery.query?.error
        ? discoverClient([preferred], inspectClient, discovery)
        : null;
    });
    ipcMain.handle("version", (event) => {
      trusted(event);
      return app.getVersion();
    });
    ipcMain.handle("choose", async (event) => {
      trusted(event);
      const result = await dialog.showOpenDialog(win!, {
        title: "选择 ChatGPT 客户端",
        defaultPath:
          process.platform === "darwin"
            ? "/Applications/ChatGPT.app"
            : undefined,
        properties:
          process.platform === "darwin"
            ? ["openFile", "openDirectory"]
            : ["openDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle("modules", (event) => {
      trusted(event);
      return builtInModules.map(({ id, name, description, version }) => ({
        id,
        name,
        description,
        version,
      }));
    });
    ipcMain.handle("inspect", async (event, path) => {
      trusted(event);
      pathArg(path);
      if (busy) throw Error("操作尚未完成");
      const result = await inspectClient(path);
      await writeFile(
        preferenceFile,
        JSON.stringify({ path: result.root }),
      ).catch(() => {});
      return result;
    });
    ipcMain.handle("diagnose", async (event, path) => {
      trusted(event);
      if (path !== undefined && path !== "") pathArg(path);
      if (busy) throw Error("操作尚未完成");
      let client: unknown;
      let clientError: string | undefined;
      if (path) {
        try {
          client = await engine.diagnose(path);
        } catch (error) {
          clientError = discoveryError(error);
        }
      }
      const data = {
        schema: 2,
        platform: process.platform,
        collectedAt: new Date().toISOString(),
        discovery,
        client,
        clientError,
        modderVersion: app.getVersion(),
        note: "仅含安装路径、发现错误、版本和资源指纹，不含账号或聊天内容",
      };
      const result = await dialog.showSaveDialog(win!, {
        title: "导出兼容诊断",
        defaultPath: "ChatGPT-Modder-diagnostic.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, JSON.stringify(data, null, 2), "utf8");
      return true;
    });
    for (const method of ["apply", "restore", "recover"] as const)
      ipcMain.handle(method, async (event, path, ids) => {
        trusted(event);
        pathArg(path);
        if (busy) throw Error("操作尚未完成");
        if (
          method === "apply" &&
          (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
        )
          throw Error("无效的模块选择");
        busy = true;
        try {
          if (method === "apply") {
            const source = await engine.inspect(path);
            if (process.platform === "win32" && source.status === "protected") {
              if (!source.patchCompatible)
                throw Error(
                  "此商店版客户端的版本或文件指纹尚未适配，请导出兼容诊断",
                );
              if (!ids.length) return await inspectClient(path);
              await assertStopped(source.root);
              path = await copies.prepare(
                source.root,
                async (root) => {
                  const state = await engine.inspect(root);
                  if (!state.compatible) throw Error(state.message);
                },
                log,
              );
            }
            const result = await engine.apply(path, ids);
            if (
              process.platform === "win32" &&
              path.startsWith(copies.storage)
            ) {
              const executable = await windowsExecutable(path);
              const shortcut = join(
                app.getPath("desktop"),
                "ChatGPT（Modder）.lnk",
              );
              let ok = false;
              try {
                ok =
                  shell.writeShortcutLink(shortcut, "replace", {
                    target: executable,
                    cwd: path,
                    icon: executable,
                    iconIndex: 0,
                    description:
                      "ChatGPT Modder 本地副本；官方商店版本保持不变",
                  }) ||
                  shell.writeShortcutLink(shortcut, "create", {
                    target: executable,
                    cwd: path,
                    icon: executable,
                    iconIndex: 0,
                    description:
                      "ChatGPT Modder 本地副本；官方商店版本保持不变",
                  });
              } catch {}
              log(
                ok
                  ? "请从桌面 ChatGPT（Modder）启动；原快捷方式仍打开官方版"
                  : `快捷方式未创建；请从 ${executable} 启动`,
              );
              await writeFile(
                preferenceFile,
                JSON.stringify({ path: result.root }),
              ).catch(() => {});
            }
            return await inspectClient(path);
          }
          if (method === "restore") return await engine.restore(path);
          await engine.recover(path);
          return await engine.inspect(path);
        } finally {
          busy = false;
        }
      });
    win = new BrowserWindow({
      width: 500,
      height: 440,
      minWidth: 480,
      minHeight: 430,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#242422" : "#f7f6f2",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      ...(process.platform === "darwin"
        ? { trafficLightPosition: { x: 18, y: 18 } }
        : {
            titleBarOverlay: {
              color: nativeTheme.shouldUseDarkColors ? "#242422" : "#f7f6f2",
              symbolColor: nativeTheme.shouldUseDarkColors
                ? "#eeeeea"
                : "#343431",
              height: 46,
            },
          }),
      title: "ChatGPT Modder",
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    nativeTheme.on("updated", () => {
      if (!win) return;
      const dark = nativeTheme.shouldUseDarkColors;
      win.setBackgroundColor(dark ? "#242422" : "#f7f6f2");
      if (process.platform === "win32")
        win.setTitleBarOverlay({
          color: dark ? "#242422" : "#f7f6f2",
          symbolColor: dark ? "#eeeeea" : "#343431",
        });
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== page) event.preventDefault();
    });
    win.on("close", (event) => {
      if (busy) {
        event.preventDefault();
        void dialog.showMessageBox(win!, {
          message: "正在写入或恢复客户端，请等待操作完成。",
          buttons: ["知道了"],
        });
      }
    });
    win.on("closed", () => {
      win = null;
    });
    void win.loadFile(uiPath);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (busy) event.preventDefault();
  });
}
