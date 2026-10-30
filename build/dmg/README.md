# DMG 包装

background-source.png 为用户提供的原背景，保持不变。build-dmg-background.swift 在其上绘制拖拽箭头并导出 1x/2x 安装界面背景；electron-builder 将两档图像合并为 Retina TIFF。

Finder 采用真实应用图标和真实 /Applications 快捷方式，不将图标及标签烘焙到背景中。原生标题栏随系统外观变化。窗口 768×592，图标 160pt，标签 16pt；坐标与背景一致，留出左下文字区域。

执行 npm run pack:dmg 重建。仅封装 Modder，不附带或修改 ChatGPT 客户端。

validation.json 记录本机实际挂载和文件检查结果；未声称完成 Finder 窗口截图验收。

修订：原 512pt 背景内容保持尺寸与顶部位置，底部增加 80pt 空白渐变；两个图标及箭头上移 40pt。窗口高度改为 592pt，为开启状态栏和路径栏的 Finder 留出余量。
