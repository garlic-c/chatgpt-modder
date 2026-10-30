# 开发交接

macOS 与 Windows 已由用户确认验证可用；当前源码 preview.11，适配客户端 26.1027.30824。早期完整排查过程已移至 history/before-preview.11-HANDOFF-WINDOWS.md。

## 开发

使用 Node.js 24，执行 npm ci、npm run typecheck、npm test、npm run build；npm start 启动修改器。Windows 打包执行 npm run pack:win，macOS 执行 npm run pack:dmg。

## 适配入口

- src/engine/discovery.ts：商店包和清单定位、诊断。
- src/engine/windows-pe.ts：PE/ASAR 哈希声明，保留算法大小写和路径格式的兼容解析。
- src/modules/adapters.ts：各平台独立的版本、资源和原生指纹。
- src/modules/quota.ts：按适配器绑定注入额度组件，保留局部加载/异常边界。
- src/engine/windows-copy.ts 与 main.ts：本地副本、快捷方式与状态管理。

更新适配时先取得真实安装资源并核对，不要仅按版本号复用另一平台的哈希。未知版本拒绝修改，备份、回滚和退出无常驻约束不变。
