# Tibo 应用图标

用户于 2026-10-30 批准 v2 并要求实装。

- Tibo.icon：Icon Composer 原生源文件，完整不透明 1024px 正方形图稿，未预制圆角和留白。已由本机 Icon Composer 27.2 / Xcode actool 27.1 验证可编译。
- optical-sources：批准的 micro / small 图稿。
- Tibo.iconset / Tibo.icns：安装版实际使用的多分辨率图标。16/32px 使用 micro，64px 使用 small，128px 以上使用 master。小尺寸采用 actool 生成的系统圆角和留白；512/1024px 使用 Composer 导出的系统圆角图稿，80% 内容区域及透明留白。

## 为什么安装版使用 ICNS

本机 macOS 27 实测：设置 CFBundleIconName、附带现代 Assets.car 时，NSWorkspace 在 32/64px 请求中仍采用统一 master 图稿，忽略 ICNS 的分尺寸专稿。因此安装版选择 macOS 仍支持的 ICNS 路径，满足批准的小尺寸光学设计。没有宣称使用运行时 Liquid Glass 分层图标。原生 .icon 源文件保留，用于后续系统支持多尺寸分层图稿时迁移。

## 重建

多尺寸 PNG 已随源码保存。在 macOS 上执行：

```
iconutil -c icns build/icons/Tibo.iconset -o build/icons/Tibo.icns
npm run pack:mac
```

大图与小图均来自用户批准的原创 AI 辅助设计；人物名称 tibo 由用户提供。这里只更改 Modder 图标，不更改 ChatGPT 客户端。

## Windows

Windows 使用同一图稿与分尺寸设计。`Tibo.ico` 包含 16/24/32/48/64/128/256px：16–32 为 micro、48–64 为 small、128–256 为 master。透明圆角和主体留白与 macOS 版保持一致。

`npm run pack:win` 自动生成 ICO；`scripts/after-pack.cjs` 将图标写入内部程序 PE 资源，便携启动器由 electron-builder 使用同一 ICO。保持不签名设置，不需要 Wine。

资源校验：

```
node scripts/verify-windows-icon.mjs 'release/win-unpacked/ChatGPT Modder.exe' 'release/ChatGPT Modder-0.1.0-preview.7-win-x64.exe'
```

这里的跨平台资源检查不等于 Windows 实机验收。资源管理器、任务栏和运行行为由用户在 Windows PC 上测试。
