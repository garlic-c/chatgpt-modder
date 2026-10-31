import { Engine } from "./engine/engine";
import { join } from "node:path";
import { homedir } from "node:os";
const command = process.argv[2],
  path =
    process.argv[3] ??
    (process.platform === "linux"
      ? "/usr/lib/chatgpt"
      : "/Applications/ChatGPT.app");
const engine = new Engine(
  process.env.CGM_STORAGE ??
    join(
      homedir(),
      process.platform === "darwin"
        ? "Library/Application Support/ChatGPT Modder/backups"
        : process.platform === "linux"
          ? ".local/share/ChatGPT Modder/backups"
          : "AppData/Roaming/ChatGPT Modder/backups",
    ),
  console.error,
);
(async () => {
  if (command === "inspect")
    console.log(JSON.stringify(await engine.inspect(path), null, 2));
  else if (command === "diagnose")
    console.log(JSON.stringify(await engine.diagnose(path), null, 2));
  else if (command === "apply")
    console.log(await engine.apply(path, ["quota"]));
  else if (command === "restore") console.log(await engine.restore(path));
  else if (command === "recover") await engine.recover(path);
  else throw Error("用法：inspect|diagnose|apply|restore|recover [客户端路径]");
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
