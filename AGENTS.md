# 开发约定

- 始终以中文沟通。Affinity 指 Canva 旗下的设计软件。
- 首先阅读 `docs/HANDOFF-WINDOWS.md` 和 `docs/KNOWN-ISSUES.md`。当前 Windows 自动定位仍失败，不能将 preview.8 描述为已支持或已通过实机验收。
- 保留版本和资源指纹校验、备份、事务回滚、不常驻的约束。未知版本拒绝修改；不能以关闭校验或放宽短变量锚点来适配。
- 未经另行明确授权，不取得 WindowsApps 所有权、不改 ACL、不删除/替换官方商店包，不关闭 Windows/macOS 系统安全设置。
- 不读取、上传或提交登录凭据、Cookie、聊天数据库、会话配置或修改器备份。不分发修改后的官方客户端。
- 先复现 Windows 自动定位故障，区分包查询、路径枚举、权限检查、客户端类型识别、版本与指纹检查。不要继续静默吞异常，也不要在类型未知时假定 Windows ChatGPT 与 macOS Electron 客户端相同。
- 修改器发布仅内置原创模块；关闭最后窗口必须结束进程。不要增加托盘、开机启动或后台服务。
- 有意义的变更运行 `npm run typecheck`、`npm test` 和 `npm run build`。Windows 实机、合成测试、macOS 构建检查必须分别报告。
- 不将 `node_modules`、`dist`、`release`、诊断输出、官方资源、密钥或机器专属路径提交到仓库。诊断保存在被忽略的 `diagnostics/`。
