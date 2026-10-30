# 0.1.0-preview.7 — 图标实装

- macOS 图标采用用户批准的 Tibo v2 图稿。
- Icon Composer 27.2 / Xcode actool 27.1 导出系统圆角；安装版使用多尺寸 ICNS，以保证小图标实际采用专稿。保留 .icon 原生源文件，当前不启用运行时 Liquid Glass 图标栈。
- 本机 macOS 27、Apple Silicon：构建、类型检查、安装和进程启动检查通过。NSWorkspace 原生图标接口已确认 32px 使用 micro 专稿、64px 使用 small 专稿。未将这些检查表述为其他 macOS 版本的实机验收。
- 旧版安装备份：项目 work/backups/ChatGPT Modder-before-preview7.app。
- 补充 Windows preview.7：采用同一套图标，启动器及内部程序均嵌入 7 档图标资源；Windows 实机显示与运行仍由用户验证。
- 不修改 ChatGPT 客户端，也不改变补丁引擎及额度模块。

图标资源和重建说明见 build/icons/README.md。
