# Windows 测试入口

先阅读 [开发交接](HANDOFF-WINDOWS.md) 与 [WIN-001](KNOWN-ISSUES.md)。当前 preview.8 自动定位仍失败。

1. 运行 `scripts/diagnose-windows-discovery.ps1`，只采集当前用户安装元信息。
2. 区分查询、候选、权限、客户端类型、版本及指纹失败。
3. 修复发现与错误可见性后，再按交接文档第 9 节验证复制、应用、启动、登录和恢复。
4. 只有真实 Windows 全流程通过后再标记该构建可用。

不要提交账号数据、诊断中的机器专属路径、客户端二进制或备份。诊断输出目录被 Git 忽略。历史 preview.2 测试清单见 `history/WINDOWS-TEST.md`，不是当前支持声明。
