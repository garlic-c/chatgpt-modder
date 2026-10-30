# 已知问题

## WIN-001：preview.8 启动后仍无法自动定位商店版 ChatGPT

- 记录日期：2026-10-30。
- 状态：开放；需要 Windows PC 复现。优先级：阻塞 Windows 使用。
- 用户证据：ChatGPT 安装在 WindowsApps，文件选择器无法手动选中；preview.8 测试后用户再次报告“问题依旧，启动时不会定位到客户端”。
- 已尝试：preview.8 增加 Get-AppxPackageManifest 实际程序路径查询、JSON/BOM 处理，以及用户目录副本原型。
- 结果：没有解决实际定位失败。副本准备、补丁、快捷方式、启动和登录均未获得此用户 Windows 实机通过证据。
- 未知：Windows 版本/架构、包名/包身份、安装路径、ChatGPT 版本、进程与程序名、客户端是否 Electron、具体失败阶段和错误。
- 禁止结论：不能说“只是 WindowsApps 权限问题”，也不能说“副本已可正常运行”。目前没有充分证据。

### 当前静默失败链

`clientCandidates()` 吞掉 PowerShell 超时、命令错误和 JSON 解析错误；`discoverClient()` 跳过 access/stat 错误，并吞掉 inspect 的异常。`clientInfo()` 仅接受指定的 Electron 包名和 PE 完整性资源。因此“已安装但类型不同/版本不同/识别失败”可能最终显示成“没找到”。

### Windows 端优先行动

1. 使用只读脚本获取真实包身份、程序路径及文件存在性。
2. 为每个发现阶段保留结果与错误，首先让“已定位但不支持/不可读”与“未安装”可区分。
3. 检查实际客户端类型，再决定是否能复用 ASAR 引擎；不要将 ChatGPT 与 Codex 或旧/新原生客户端混为同一产品。
4. 只有在版本与资源已适配后，才验证副本流程。

详见 [执行级交接](HANDOFF-WINDOWS.md)。
