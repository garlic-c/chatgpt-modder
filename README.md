# ChatGPT Modder

可扩展、无需后台常驻的 ChatGPT 桌面修改器。Electron + TypeScript，仅加载内置模块。

**当前 Windows 原型为 `0.1.0-preview.8`，启动时仍无法在用户 Windows PC 上自动定位商店版客户端。Windows 支持尚未验收，请先阅读 [Windows 开发交接](docs/HANDOFF-WINDOWS.md) 和 [已知问题](docs/KNOWN-ISSUES.md)。** macOS 最近交付为 preview.7，用户已确认补丁后能正常启动并显示额度；这不代表所有权限、通知或更新场景已完整验收。

## 首个模块

头像上方显示 5H 剩余百分比、重置倒计时及周剩余细进度条。百分比不超过 10% 时变红，单位为小写，进度条为 1px。复用客户端账号额度状态；未知或失效数据使用占位，切换账号清除旧数据。组件自带异步与异常边界，不应阻塞整页初始化。

## 开发

使用 Node.js 24、npm、Git。在干净克隆目录执行：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm start
```

macOS 与 Windows 可分别执行 `npm run pack:mac`、`npm run pack:win`。macOS 还可执行 `npm run pack:dmg`，重绘背景时需要本机 Swift/AppKit；这些命令不适用于 Windows。Windows 打包使用内置 ICO 与 PE 资源编辑脚本，不依赖 Icon Composer 或 Wine。

Windows 调试的首个步骤是只读采集安装元信息：

```powershell
powershell.exe -NoProfile -File .\scripts\diagnose-windows-discovery.ps1
```

若系统策略禁止执行脚本，请按交接文档逐条运行只读命令；无需更改系统执行策略。结果位于 `diagnostics/`，不会自动上传。

## 当前平台策略

| 平台 | 状态 |
| --- | --- |
| macOS Apple Silicon | 已有本机及用户启动、额度显示证据；最近安装包 preview.7 |
| macOS Intel | 未验收 |
| Windows 商店版 | preview.8 自动定位仍失败；包类型、路径、权限及识别失败原因未知 |
| Windows 用户目录副本 | 代码原型已实现，尚未进入用户实机验收；可能受包身份及登录回调影响 |
| Windows 非商店版 | 仅实验适配，未完成实机验收 |

Windows 原型拟自动读取商店包清单，再为兼容版本创建用户目录副本并生成“ChatGPT（Modder）”快捷方式。它不修改 WindowsApps、不会改变官方快捷方式，也不保证副本沿用登录状态。当前发现阶段即失败，不能将该流程当作已可用功能。

已知适配器目前仅记录客户端 `26.1023.51421`；Windows 记录沿用相同构建的共享 UI 指纹，未取得用户 Windows 客户端实物证据。不同产品、客户端类型和版本需要单独研究，不能直接放宽校验。

## 目录

- `src/engine/`：发现、识别、完整性、备份、事务与恢复。
- `src/modules/`：内置额度模块及已知版本适配器。
- `src/ui/`：简化界面与预览。
- `scripts/`：构建、图标与只读诊断。
- `build/`：原创图标、Icon Composer 源文件和 DMG 背景。
- `docs/`：当前交接、架构、验证及故障记录；`docs/history/` 为历史记录。

[架构与扩展](docs/ARCHITECTURE.md) · [验证状态](docs/VALIDATION.md) · [Windows 验证清单](docs/WINDOWS-TEST.md)

## 发布与恢复

仅分发修改器及原创补丁，不分发官方客户端或其修改副本。客户端运行时拒绝修改；失败回滚；版本或指纹改变后拒绝套用旧补丁和旧备份。关闭最后窗口即退出，无托盘、启动项或后台服务。

安装包尚未使用公开发行证书签名或 Apple 公证。正式发布前需完成平台实机验收与发行处理。

MIT 许可证只覆盖本项目原创代码；第三方归属见 [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)。图标人物名称 Tibo、DMG 背景与文字由用户指定；不代表官方发布或背书。
