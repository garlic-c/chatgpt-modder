# Windows 测试入口

> 最新用户反馈：应用修改后普通重启没有效果，原因尚未确认（WIN-003）。下文成功证据来自隔离测试路径，不代表普通快捷方式/默认配置流程已验收。先阅读 [Windows 运作原理与风险](WINDOWS-OPERATION-AND-RISKS.md) 与 [当前问题](KNOWN-ISSUES.md)。

> 最新版本为 preview.10：26.1027.30824 已加入实验适配，真实独立副本事务、用户手动登录和真实额度显示通过；完整切号/休眠/更新流程未全面验收。详见 [preview.10 验证](WINDOWS-preview.10.md)。下文历史状态按对应版本理解。

先阅读 [开发交接](HANDOFF-WINDOWS.md) 与 [已知问题](KNOWN-ISSUES.md)。当前 preview.9 已修复本机自动定位，实际新版本尚未适配。

## 2026-10-30 接手验证

- 环境：Windows 11（10.0.26200）、x64、Node 24.22.1，普通用户查询当前用户包。
- 修复前实机：包查询成功，主程序目录存在；`Engine.inspect` 抛出“Windows 完整性资源格式不匹配”，`discoverClient` 返回 null。
- 实机格式：PE 的 `INTEGRITY/ELECTRONASAR` 资源使用大写 `SHA256`，file 中有双反斜杠；ASAR 包产品名为 `openai-codex-electron`。
- 修复后实机：返回主程序目录，版本 `26.1027.30824`；PE 声明哈希等于 ASAR 头哈希。修改禁用，`patchCompatible=false`。已导出本机安装资源版本和指纹到忽略目录，未复制或修改官方资源。
- 合成测试：类型检查、构建通过；41 项测试中 40 项通过、1 项按既有规则在 Windows 跳过。恢复、回滚与副本测试均为合成安装，不能等同真实客户端全流程。
- 另修复 Windows 下两处跨平台测试路径问题：macOS 候选用 posix 路径；第三方 ASAR 提取器测试输入用宿主 normalize 路径。
- 打包：使用既有 Windows 图标资产生成 preview.9 x64 portable；本机无系统 npm，使用工作区 npm，打包执行与 pack:win 相同的构建/打包步骤。electron-builder 依赖收集回退到内置目录遍历并成功；程序未配置代码签名。
- GUI：已验证“已定位”和未知版本提示，修改开关禁用。紧凑窗口布局保留底部诊断入口。
- 系统禁止运行 ps1：按交接文档逐条执行只读命令，未更改执行策略。没有退出用户正在运行的官方客户端。
- 证据：本机忽略目录 `diagnostics/windows-real-validation.json`；只含安装元信息和资源指纹，不提交或上传机器路径。

未执行：真实客户端副本、补丁、登录、额度展示、恢复、官方更新全流程；macOS 本轮未运行。

## 后续顺序

1. 运行 `scripts/diagnose-windows-discovery.ps1`，只采集当前用户安装元信息。
2. 区分查询、候选、权限、客户端类型、版本及指纹失败。
3. 修复发现与错误可见性后，再按交接文档第 9 节验证复制、应用、启动、登录和恢复。
4. 只有真实 Windows 全流程通过后再标记该构建可用。

不要提交账号数据、诊断中的机器专属路径、客户端二进制或备份。诊断输出目录被 Git 忽略。历史 preview.2 测试清单见 `history/WINDOWS-TEST.md`，不是当前支持声明。
