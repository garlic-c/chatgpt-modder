# Windows 开发交接 — 2026-10-30

> 最新用户反馈：应用修改后普通重启没有效果，原因尚未确认（WIN-003）。下文成功证据来自隔离测试路径，不代表普通快捷方式/默认配置流程已验收。先阅读 [Windows 运作原理与风险](WINDOWS-OPERATION-AND-RISKS.md) 与 [当前问题](KNOWN-ISSUES.md)。

> 最新版本为 preview.10：26.1027.30824 已加入实验适配，真实独立副本事务、用户手动登录和真实额度显示通过；完整切号/休眠/更新流程未全面验收。详见 [preview.10 验证](WINDOWS-preview.10.md)。下文历史状态按对应版本理解。

> Windows 接手更新：源码已到 `0.1.0-preview.9`。本机已复现并修复 PE 完整性资源格式导致的发现结果丢失，窗口能显示“已定位”。实际客户端 `26.1027.30824` 尚未适配，保持只读诊断；副本、登录与额度完整验收仍未完成。以下 preview.8 描述为交接历史，最新状态见 `KNOWN-ISSUES.md` 和 `WINDOWS-TEST.md`。

## 0. 接手结论

当前源码版本 `0.1.0-preview.8`。**首个任务是复现并修复自动定位，不是直接测试打补丁。** 用户再次确认该版启动后仍无法定位 WindowsApps 内的 ChatGPT；38 项自动化测试通过并没有解决实际问题。当前无 Windows 客户端实物、运行日志、安装元信息或实机通过证据。

本次整理只记录故障、整理源码与文档，增加一个只读安装元信息脚本，并将测试入口改为跨 shell 的显式文件列表；没有声称再次修复 Windows 发现故障，也没有重新发布二进制。原 preview.8 EXE 不包含本次交接脚本。

## 1. 固定目标和用户约束

- 支持 macOS 与 Windows；Windows 实机开发和验收由用户在另一台 PC 完成。
- 修改器可扩展，仅加载随程序发布的内置模块，不加载任意外部脚本。
- Electron + TypeScript；关闭最后窗口即退出，不加托盘、开机启动、后台服务。
- 安装后的功能随 ChatGPT 运行，不依赖修改器常驻。
- 修改前退出客户端、核对版本和文件指纹、备份；失败回滚；官方更新后不得自动套旧补丁或恢复旧备份。
- 只分发修改器及原创补丁，不分发官方客户端及其修改副本。
- 不以接管 WindowsApps 所有权、改 ACL、关闭完整性或系统保护来“修复”。
- 不读取或提交凭据、Cookie、聊天内容及完整配置目录；账号秘密只留在本机。

## 2. 用户已确认的界面与模块

### 修改器界面

500×440、最小 480×430，无左栏，非交互文本不可选中；顶部 ChatGPT Modder + 客户端“已定位”按钮；功能名“在用户头像上方查看用量”，开关在名称下；右侧仅显示侧栏头像局部，示意为 42%、抽象对话线条及“你”。版本号位于底部诊断按钮左侧，运行日志仅保留最新 3 条，不滚动查看。不要把调试研究声明重新堆回主界面；但实际错误必须可见。

### 额度模块

头像上方按顺序显示 5H 剩余百分比、重置倒计时、1px 周进度条；剩余不超过 10% 时百分比变红；倒计时单位小写；周条宽度与时间文本一致，悬停显示周百分比。跟随头像中心，兼容深浅主题与侧栏展开/收起。

账号切换清除旧值，失效/离线用占位，达到重置时间只请求刷新、不自行认定恢复额度；休眠唤醒按当前时间算。组件需防重复和卸载清理。历史启动挂起由异步状态越过加载边界及本地签名授权等待等因素排查过，不能移除局部 Suspense/异常边界。

### 图标与 DMG

Tibo v2 已批准。16/32px 为 micro 简化稿，64px 为 small，128px 以上完整稿；Windows ICO 为 16/24/32/48/64/128/256 七档。同套图稿跨平台使用，不能退回 Electron 默认图标。

macOS 安装版选择多尺寸 ICNS，以保证小图标专稿生效，保留 Icon Composer 原生源文件；未启用运行时 Liquid Glass 栈。DMG 使用用户背景，768×592 逻辑尺寸、Retina 双图、底部新增 80pt 空白；应用与 Applications 的中心分别 (235,180)、(535,180)，较原版均上移 40pt，箭头同样上移。不要在 Windows 调试时重画这些资产。

## 3. 接手环境与启动

在用户授权的私密仓库克隆后，使用 Node.js 24、npm、Git。普通用户身份开始，无需管理员启动 Modder。

```powershell
git clone https://github.com/GarliC-C/chatgpt-modder.git
Set-Location chatgpt-modder
npm ci
npm run typecheck
npm test
npm run build
npm start
```

仓库已发布为私密仓库；在 Windows 上先用有访问权的 GitHub 账号完成 Git 认证，再克隆。也可使用交付的离线源码归档。

- `npm ci` 会下载开发依赖与 Electron；需正常网络。
- `npm start` 会先构建，不会自动给 ChatGPT 打补丁。
- `npm test` 使用 `scripts/run-tests.mjs` 显式传递测试文件，避免 Windows cmd.exe 不展开通配符。
- 仓库不带 Mac 的 node_modules 符号链接、dist、release 或客户端资源。不要从旧 Mac 工作目录拷贝依赖，应在 Windows 执行 npm ci。
- PowerShell 不能执行 npm.ps1 时可以使用 `npm.cmd`；不必修改系统执行策略。
- 构建 Windows：`npm run pack:win`，输出到 `release/ChatGPT Modder-0.1.0-preview.8-win-x64.exe`。修复后发布新版本号，不覆盖用户已反馈失败的版本。
- macOS 的 Swift/AppKit、codesign、plutil、Icon Composer 不应成为 Windows 构建依赖；`pack:mac`/`pack:dmg` 仅在 Mac 运行。

## 4. 已发生的 Windows 问题与证据边界

1. 用户报告 Windows 官方 ChatGPT 位于 WindowsApps，无法通过文件选择器手动选中。
2. 原版已有 Get-AppxPackage 搜索，但商店目录一律禁止修改。
3. preview.8 改为读取 Appx 清单的 Executable 路径，支持 BOM/JSON 单值与数组；增加用户目录副本原型。
4. 在 Mac 上完成类型检查、构建、38 项测试和 Windows 图标资源检查。
5. 用户实机反馈：“问题依旧，启动时不会定位到客户端。”
6. 用户决定改在 Windows PC 上继续开发，要求先记录、清理并交接。

**未取得：** Windows 版本、架构、实际包名和版本、真实 Executable 路径、程序类型、错误栈、PowerShell 输出、权限错误。不能在没有这些证据时认定是 ACL、包名、超时或某种客户端架构造成的。

## 5. 首轮只读采集

先运行：

```powershell
powershell.exe -NoProfile -File .\scripts\diagnose-windows-discovery.ps1
Get-Content .\diagnostics\windows-discovery.json
```

脚本不修改安装、不启停客户端、不读账号数据；仅写入忽略目录。它比 App 当前正则更宽地查询名称中含 OpenAI/ChatGPT/Codex 的当前用户包，记录包身份、版本/架构、安装位置、清单程序、指定安装文件是否存在、包查询耗时和同名进程的可执行路径。不要把运行进程命令行或完整用户配置加入报告。

脚本在 Mac 上只能静态审阅，**尚未在 PowerShell 实机运行**。若被系统策略拦截，不更改策略；在普通 PowerShell 中逐条执行：

```powershell
$PSVersionTable.PSVersion
[Environment]::Is64BitProcess
Get-AppxPackage | Where-Object { $_.Name -match '(OpenAI|ChatGPT|Codex)' } | Select-Object Name,Version,Architecture,PackageFullName,PackageFamilyName,InstallLocation
```

将实际 PackageFullName 赋给 `$packageName` 后继续：

```powershell
$packageName = '这里填写上一步得到的实际 PackageFullName'
$manifest = Get-AppxPackageManifest -Package $packageName
$manifest.Package.Applications.Application | Select-Object Id,Executable,EntryPoint
```

只对确定的应用根目录做 Test-Path，检查 `resources\app.asar`、`ChatGPT.exe`、`Codex.exe`、`AppxManifest.xml`。不要递归扫描整个 WindowsApps 或系统账号目录。若包名并非 OpenAI 前缀、或程序不是目前假设的 Electron 类型，应先记录事实并修改识别策略，而不是仅改权限或强行复制。

## 6. 发现链逐段定位

### A. PowerShell 查询

文件：`src/engine/discovery.ts`。

当前入口 clientCandidates() → powershell.exe → storeDiscoveryScript；超时 8000ms、maxBuffer 1MiB。过滤 `^OpenAI[.].*(ChatGPT|Codex|Desktop)`，使用当前用户包，不查询 AllUsers。读取清单 Executable 的父目录，并回退到 InstallLocation 和其 app 子目录。

需要记录：命令是否存在、退出码、耗时、stderr、stdout 是否为空、是否为合法 JSON、包名是否命中过滤。不要仅记录一个“没找到”。当前 catch 会吞掉这些错误，结果只剩常见安装目录。

可能原因仅是假设：过滤遗漏实际包名、包查询超时、PowerShell 错误/输出编码、策略拦截、缺少清单读取权限。先通过证据排除，不要一次把所有限制放宽。

### B. 候选目录

同文件 discoverClient() 会 access/stat，非目录/不可访问直接跳过；inspect 抛错也被吞掉。需将这些情况和“目录根本不存在”区分。

记录每个候选目录的来源（偏好/常见位置/清单/包根目录）、存在性与错误码。发现官方包但无法读取时，UI 应显示“已定位，无法读取/不支持”，不能退回“选择客户端”并要求用户去选受保护目录。

### C. 产品和资源类型

文件：`src/engine/platform.ts`。

Windows clientInfo() 当前要求 `<root>\resources\app.asar`，其中 package.json.name 必须为 `openai-codex-electron`，程序名只尝试 `ChatGPT.exe`、`Codex.exe`、`codex.exe`，并要求 PE 存在已知 Electron ASAR 完整性资源。

这套条件来源于已有新版 Mac 同构建适配，**没有证明用户 Windows ChatGPT 符合它**。某个失败分支抛错会在发现层消失。必须验证实际 Windows 客户端类型；若不是相同 Electron 产品，应独立研究适配能力并明确“不支持”，不能假称路径发现失败。发现阶段不要改官方二进制。

### D. 版本与适配器

文件：`src/modules/adapters.ts`、`src/engine/engine.ts`。

唯一已知版本 `26.1023.51421`。Mac 记录整体 ASAR 头、共享 UI 及原生组件指纹；Windows 实验记录同版本共享 UI 指纹，headerHash=null 仅表示未锁定整个归档，**仍检查共享文件及 PE/ASAR 一致性**。

如果产品相同但版本不同，先导出安装资源版本/指纹，取得相应官方构建，再做适配。不得删除 checkFiles 或完整性检查。额度模块的短变量和注入锚点不跨版本保证成立。

### E. 主进程与界面

`src/main.ts` 的 detect IPC → discoverClient → inspectClient；`src/ui/app.ts` 展示结果。界面无 Node 权限，通过 preload 的受限接口调用主进程。若要增加阶段诊断，保留来源校验、上下文隔离、沙箱和无远程代码加载的约束。

目前诊断按钮依赖已发现的路径；当发现返回 null 时按钮无法导出。这也是后续应修复的观测性缺口，可加入独立的发现阶段元信息导出，不需要读取会话。

## 7. preview.8 用户目录副本原型

发现失败未修复前，不要把此节当作已通过验证。

流程：protected + patchCompatible → UI 显示将创建副本 → 用户应用 → 检查官方进程停止 → WindowsCopy.prepare() → Engine.apply() → 创建桌面快捷方式。

- `src/engine/windows-copy.ts`：按来源规范路径 + 原 ASAR 哈希分目录；先计算原目录指纹、独立复制到 preparing、比较复制前后，再清理副本内 MSIX 描述文件、令副本可写、验证、原子改名。原始安装和 ACL 不变。
- 本地路径：`%APPDATA%\ChatGPT Modder\clients\<来源指纹>\client`；来源记录位于相邻 origin.json。具体以 app.getPath('userData') 为准。
- 备份：`%APPDATA%\ChatGPT Modder\backups\<目标路径指纹>\`，含 manifest、事务、原版副本等。不要上传。
- 桌面快捷方式：`ChatGPT（Modder）.lnk`；只在补丁成功后创建。官方快捷方式仍开原版。
- 副本不注册成官方 MSIX，不自动拷贝登录数据，可能需要重新登录；可能依赖包身份、系统组件、协议处理或 OAuth 回调，需要实机验证。若不能独立运行，重新设计方案，不要用管理员强写 WindowsApps 兜底。
- 官方新包优先；检测到新包但不兼容时，不回选旧副本。新来源分目录保存，避免旧备份覆盖新客户端。旧副本/备份暂不自动清理。
- restore 恢复的是副本。CLI 直接调用 Engine，不提供 GUI 的自动发现及副本管理；不要在 CLI 对 WindowsApps 执行 apply。
- 同一账号 profile 的复用方式没有得到验证；不要猜测 user-data-dir 或链接现有资料目录，避免同时使用造成破坏。

## 8. 基础引擎与已解决的 Mac 问题

`Engine` 依次执行停止检查、指纹校验、原目录备份、原版重新构建、完整性更新、平台校验、二次检查、目录替换与提交。失败回滚；异常中断保留 transaction.json 并支持 recover。修改后的目录如果被官方升级/其他工具改动，禁止旧版恢复。

Electron 会虚拟化 `.asar`，修改器必须使用 `src/engine/native-fs.ts` 的 original-fs 访问真实文件，不能换回普通 fs 做复制和整目录校验。Windows PE 资源更新位于 windows-pe.ts；图标资源编辑是打包修改器自己的 EXE，和客户端补丁不要混淆。

Mac 曾因主资源/框架的完整性摘要、签名团队授权、钥匙串系统授权及异步 Suspense 出现初始化挂起。用户最终确认启动和额度显示正常。Windows 开发不应顺手重构这些已工作的代码，也不要把“Mac 能启动”当作 Windows 可用证据。

## 9. 验证顺序和停止条件

1. 普通用户启动修改器，真实包可自动定位；错误可导出，不需进入 WindowsApps 文件选择器。
2. 区分未安装、目录不可读、产品不支持、版本不支持、指纹不匹配、已准备副本。
3. 先确认实际客户端类型和匹配适配器；不匹配时停在只读诊断。
4. 检查客户端运行时拒绝修改，保持官方文件和权限不变。
5. 副本独立准备、复制失败/空间不足/中断清理及重复准备；旧副本不被新版本覆盖。
6. 在可恢复环境应用、重复应用、停用、重新启用、恢复。核对副本与备份，不能误改官方包。
7. 从新快捷方式验证启动、登录、回调、额度显示及恢复。不要宣称能无缝继承登录，除非真实确认。
8. 深浅主题、展开/收起、10% 红色、1px 周条、空/离线/耗尽/重置/切号/休眠唤醒；不要为测试故意消耗大量额度。
9. 关闭 Modder 后进程退出，补丁客户端仍工作；再验证官方更新和升级保护。
10. 原官方快捷方式仍正常启动原客户端。副本不会随商店自动更新，需要明确维护策略。

每一步记录“环境、动作、预期、实际、证据路径、是否可回滚”。测试报告分开写自动化测试、打包验证、Windows 实机结果。失败时先记录准确阶段，不以继续破坏性操作来追求下一步。

## 10. 发布与后续交付

当前交接为私密源码仓库，不附官方客户端、调试备份、账号资料或 node_modules。构建输出和本机诊断被忽略。发布新 EXE 前更新 package.json、package-lock.json，并保留变更说明及校验值；不要将失败的 preview.8 标成正式支持。

用户 Windows PC 还应确认：真实系统/架构、包名/版本、候选与错误、能否读取安装文件、是否同一 Electron 构建、复制与启动/登录、恢复、商店更新、退出无常驻。未通过前继续标为实验适配。
