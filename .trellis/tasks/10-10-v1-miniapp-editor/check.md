# T18 独立检查

日期：2026-10-11。结论：**开发范围检查通过**，可由主会话提交/归档并接 T19/T21/T20。真实账号配置、真机键盘/内存/图片兼容及打印继续按 D-044 留给 Owner，不视作通过。

## 范围与修复

独立审查了此前未由本检查者实现的 App 内存会话、模板/编辑/分页预览/My 承接壳、原生组件、样式/分享资源、D-046 清理和对应测试/模拟器脚本。未修改 root 的 CloudClient、PDF 下载器、服务配置或构建配置。

1. **修复拼音片段正文不可见**：实际 `editor-pinyin.png` 显示 34 mm 片段只含单行标题＋空行，正文首行在片段外。主会话确认后改为固定 52 mm（三个完整行带）；只扩大屏幕片段，不改任何纸张/布局/字体参数。新增真实 MiSans Latin + 实际打包原生页面回归，旧值明确失败，修复后首行所有实际墨迹均在 viewport 内且布局摘要不变。官方脚本也检查首行正文可见，最终截图已目视确认。
2. **防止陈旧通过报告**：官方脚本新一轮开始先删除旧 `report.json`，失败或中断不能留下旧通过状态冒充本轮结果。
3. **规范同步**：frontend index/component/quality/canvas-preview 记录已经存在的 T18 页面、viewport 和 snapshot 约束/验证入口；不再保留“没有正式页面”或“测试命令待添加”的过时状态。

## 本轮验证

| 命令/检查 | 结果 |
|---|---|
| `npm run test:canvas` | 22/22；含 viewport 全页预检与 snapshot 大小/API/解码/取消/卸载 |
| `./node_modules/.bin/tsc -p tsconfig.json` | 通过；字体/Canvas 构建先由 test:canvas 完成 |
| `npm run build` | 通过；修复前后均从当前源码生成原生输出 |
| `node --test miniprogram/test/editor-session.test.mjs miniprogram/test/editor-native.test.mjs packages/runtime-smoke/test/runtime.test.mjs` | 修复后 24/24：T18 独占 11 + native host 13 |
| `node scripts/test-editor-devtools.mjs --diagnostics` | 修复后官方 9 组、0 应用异常；基础库 3.17.3 / 模拟微信 8.0.5 |
| `git diff --check`（T18/前端 spec 相关路径） | 通过 |
| 前端 spec 相对链接、官方脚本语法 | 通过 |

构建仍有已知第三方字体依赖的重复 `axisIndex` 键警告，未修改供应商代码。

## 关键审查结论

- Canvas 精确绘制共享字形/格线，viewport 只改显示变换与分配高度，屏外字形继续预检。snapshot 不改变布局、字号或分页，不替代正式 PDF。
- PNG 仅通过内存 data URL 进入原生 image；单次上限 900,000 字符在桥接前校验，编码后 backing bitmap 归还 1×1。当前模拟最大 427,334 字符。新 revision、clear、卸载可结束旧等待；旧图片事件不能完成新请求，解码失败不报告 ready。
- 原文和布局不写 storage、路由、日志或默认分享；分享使用固定 PNG 和模板路由。唯一 EditorSession 由 App 持有，各独立打包页面通过 getApp 共享。
- 标题/正文与原始 CR/LF/CRLF/空行保留。设置默认收起，恢复只改两项设置；描红/展开不重建 textarea，预览返回保留输入。
- D-046 只在主动整理时运行；展示任意输入的前后对照，取消不改文，应用核对正文 revision/内容，撤销不覆盖后续正文编辑。标题/描红/设置不使撤销丢失。
- 本轮浏览 `templates`、`editor-filled`、`cleanup-preview`、`preview`、`preview-zoom-edges`、`editor-pinyin` 实际截图：输入、翻页/缩放/按钮和模态遮罩未被纸张覆盖；放大后可滚到右/下边并还原，摘要不变。修复后的拼音首行正文现在可见。

## 交付与后续

本检查额外修改：`miniprogram/pages/editor/index.ts`、`miniprogram/test/editor-native.test.mjs`、`scripts/test-editor-devtools.mjs`、四份 frontend spec、本任务 design/evidence/implement/check。未提交或归档。

T19 接唯一 App.client 和兼容/更新会话，T21 接账户/生成记录/文件，T20 接真实提交。当前 My 壳/生成禁用提示属于明确阶段边界，不能写成全链路完成。Owner 最终真机与配置项目仍见 [最终验收清单](../../../docs/FINAL_ACCEPTANCE.md)。
