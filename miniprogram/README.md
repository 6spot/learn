# 原生小程序

`app.ts` 持有唯一内存编辑会话，各独立打包的页面通过 `getApp()` 使用它。模板、编辑与分页预览已接入共享排版及原字体 Canvas；开发诊断页仍保留。双 tabBar 为“纸张 / 我的”，账户、生成、记录的后续集成由 T19–T21 管理。

- `pages/templates`：四模板默认规格与完整白纸缩略图。仅缩略图增强线条显示对比，不覆盖正式预设。
- `pages/editor`：可选标题/正文、可见描红、默认折叠设置、真实换行整理对照/应用/撤销，以及完整行边界的纸张片段。
- `pages/preview`：一个页面内翻页、放大/还原及双向滚动，返回保留输入。只分配当前一页画布。
- `lib/editor-session.ts`：锁定预设、输入/设置、异步预览版本和撤销。`text-cleanup.ts` 实现 D-046 保守转换；不会在输入或排版时自动改写正文。
- `components/paper-canvas`：接收已有布局和原字体轮廓。编辑片段使用真实缩短的 Canvas viewport；编辑/预览用其生成的当页内存 PNG 交给原生 image 呈现，支持滚动裁剪/模态遮盖，不依赖原生 Canvas 层叠行为。等待图片解码成功后才报告就绪；单次桥接限制 900,000 字符，不写文件，编码后释放画布，换页/离页清空图片。

正文仅在当前 App 内存、原生输入桥接和用户主动整理对照中使用，不持久化或写入日志/路由。模板分享固定为代码绘制的 `assets/share-paper.png`，避免默认截图包含输入内容。`scripts/generate-ui-assets.py` 可再生分享图和 tab 图标，不含第三方素材。

开发配置未接通时，生成按钮明确禁用。字体使用已校验原文件；空白纸不要求字体下载，有字缺字体时显示可重试错误，不使用系统字体替代。

```sh
npm run build
npm run typecheck
npm run test:editor
npm run test:canvas
npm run test:editor:devtools
```

官方模拟器脚本只输入固定合成样例，通过真实原生控件验证后将报告/截图写入忽略目录 `dist/editor-evidence/`。输入事件、App 草稿、布局版本和画布就绪分别等待，避免把旧画面当作新输入的验证。需按 [字体说明](../assets/fonts/README.md) 恢复本地原字体；脚本只向当前模拟器私有目录分块注入它们。各 DevTools 脚本串行运行。

模拟验证不代表真实 iOS/Android 键盘、焦点、内存性能、授权字体分发或打印验收。按 Owner 指示，这些与平台组件/账户配置统一留到最终验收。
