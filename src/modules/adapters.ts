import type { Adapter } from "./types";
export const adapters: Adapter[] = [
  {
    id: "mac-26.1023.51421-arm64",
    platform: "darwin",
    version: "26.1023.51421",
    headerHash:
      "a240f14c9d701a8740ec4d028b3dfdcabeafe85aa8abc79e5dd0e5954844bd2f",
    status: "experimental",
    files: {
      "webview/assets/app-primary-b7f335b763ca.js":
        "a06a6efddedd56a46fedf6919d3c12a5fc73b2ae591bf9a4dc249c8c975f0f78",
      "webview/assets/app-initial-bc8256c3cccb.js":
        "296e75c2132f346f3fec495607aa8578c1a0219b90b9bf96673ae7aa5a45e352",
    },
    nativeFiles: {
      "Contents/MacOS/ChatGPT":
        "44342669fea068c3d335eff7cc40ee110b34fa4ff3570bb03cc507bd73fe980d",
      "Contents/Frameworks/Codex Framework.framework/Codex Framework":
        "cb865395d220c6541e4288b161cc4a8cacab7e38de34cc130477195881af542f",
    },
  },
];

// Windows counterpart is experimental and requires identical shared UI file fingerprints.
const mac = adapters[0];
adapters.push({
  ...mac,
  id: "win-26.1023.51421-shared-ui-experimental",
  platform: "win32",
  headerHash: null,
  nativeFiles: undefined,
  status: "experimental",
});

// Windows 26.1027.30824: inspected installation resources; never infer aliases at runtime.
adapters.push({
  id: "win-26.1027.30824-x64",
  platform: "win32",
  version: "26.1027.30824",
  headerHash:
    "58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85",
  status: "experimental",
  files: {
    "webview/assets/app-primary-998934e837fc.js":
      "084d7102a8eca9a49fc37e25d7b95c2c8052d3b5b2709e28867e266748d761a0",
    "webview/assets/app-initial-4267e52fe5b0.js":
      "ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e",
    "webview/assets/app-shared-b9a49a97ca55.js":
      "f4b8ddb204fe43881fe4a625c09938e96aca597585583af1d86fc611c79d2e47",
  },
  quota: {
    target: "webview/assets/app-primary-998934e837fc.js",
    profile: "hwn",
    react: "ywn",
    jsx: "Uq",
    account: "ok",
    read: "J",
    query: "Nb",
    scopeHook: "rf",
    scope: "Z",
    guards: [
      "Vhn as Nb,",
      "zFn as ok,",
      "function hwn(e){",
      "ywn=lf()",
      "Uq=q()",
      "function MG(){",
      "um(),jG=",
    ],
  },
});
