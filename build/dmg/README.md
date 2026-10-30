# DMG 背景与布局

- 原图：background-source.png，人物与文字保持原位置和大小。
- 纹理扩图：background-extended.png，由 imagegen 向下延展原有蓝色毯面折纹生成。
- 构建脚本将原图主体叠回，并仅在文字下方的空白尾部与生成纹理柔和衔接，避免改变原有排版。
- 画布：768×602pt / Retina 1536×1204px；原图高度 512pt，底部纹理延展共 90pt，较上一版再增加 10pt。
- 图标中心 (235,180)、(535,180)，箭头位置不再改变；Finder 使用真实应用与 Applications 快捷方式。

执行 npm run pack:dmg 重建。背景不再通过纯色或线性渐变填充底部。
