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
  status: "verified",
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

// macOS uses the same client version as Windows, but platform-specific assets.
// Every alias below was checked in the fingerprinted macOS resource, not inferred
// from matching version strings alone.
const windowsCurrent = adapters.find((a) => a.id === "win-26.1027.30824-x64")!;
adapters.push({
  ...windowsCurrent,
  id: "mac-26.1027.30824-arm64",
  platform: "darwin",
  status: "verified",
  headerHash:
    "a452d061300e76daf2f9e32a08b74b7d6ea6a54a3c4e4665cf1ee5f1f1ef5ce2",
  files: {
    "webview/assets/app-primary-95a0e6d83f1e.js":
      "e6b2abb4c858523506c5205b7628b106f82c2e043b085fa35be829b8999829f7",
    "webview/assets/app-initial-60f141238751.js":
      "72b67fc719cccb37a1da02fd06f71d840ec2805b813c1fac3a4fc5cca59cc16c",
    "webview/assets/app-shared-7815d5a1a42a.js":
      "78f88eb7bb88cc8271103ee6e27e7c51c5d44a185b8b4923386f7d207659c0c4",
  },
  nativeFiles: {
    "Contents/MacOS/ChatGPT":
      "df23c13298327375ad613bb43d69dab6706591898a026e223316763b0ad7b069",
    "Contents/Frameworks/Codex Framework.framework/Codex Framework":
      "3e97c7605a57927741f918bdb55c1f63c9b37d3549133386e472ca38e097a76a",
  },
  quota: {
    ...windowsCurrent.quota!,
    target: "webview/assets/app-primary-95a0e6d83f1e.js",
  },
});

// Linux 26.1027.30824: every fingerprint and alias below was read from the
// official .deb resources, never inferred from the macOS/Windows builds.
// The data path differs from Windows: the usage state lives in a store query
// node (qh, imported from the initial chunk) whose data is the usage
// response; components subscribe through the generic atom hook (Z) and the
// store from df(J) invalidates the node. The sidebar footer profile
// component is YEn, in a module whose React namespace is $En (Sf()) and
// whose JSX namespace is lG (q()).
adapters.push({
  id: "linux-26.1027.30824-x64",
  platform: "linux",
  version: "26.1027.30824",
  headerHash:
    "641cd0b02ef1127e9733e4f4e77facc66e8e6e321a8afe5ddddf26a86836b816",
  status: "experimental",
  files: {
    "webview/assets/app-primary-7029a31b5fe1.js":
      "a411fb8c853a41a9dfd4ab6b6ca19d08099abf3454e03ac2461aae69ab7b2028",
    "webview/assets/app-initial-c4cac3105190.js":
      "5092c2aa079ed1435df53e4b2b758776e0ba405b3dae56207ab6a65c3e08374f",
    "webview/assets/app-shared-7a3b5b1a0788.js":
      "bdfe90b6091c0ae04f83bb37946782f9c4ed9dd3b2baabb988017e2a57ba8d40",
  },
  nativeFiles: {
    ChatGPT:
      "b9ff66b1ceea3cecd6211d9de5de80424bbacf5c3f080c056fe8a1f7d5fac69e",
  },
  quota: {
    target: "webview/assets/app-primary-7029a31b5fe1.js",
    profile: "YEn",
    react: "$En",
    jsx: "lG",
    account: "cv",
    read: "Z",
    query: "qh",
    scopeHook: "df",
    scope: "J",
    guards: [
      "function YEn(e){",
      "$En=Sf()",
      "lG=q()",
      "PFn as cv,",
      "oTt as Z,",
      "Ihn as qh,",
      "rTt as df,",
      "lU=Re(J,",
      "let{data:n}=t(qh)",
    ],
  },
});
