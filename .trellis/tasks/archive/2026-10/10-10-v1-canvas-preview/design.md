# T08 设计边界

> 状态：2026-10-11 本地执行设计；Canvas 2D 实例与截图由微信开发者工具模拟器实测，真机/打印保留最终清单。

## 责任与依赖

renderers/canvas（职责目录待落地）、小程序 Canvas 适配。

前置交付：[T07 实现排版版本与摘要协议](../10-10-v1-layout-versions/prd.md)

## 实现边界

1. `packages/canvas-renderer` 消费 `PaperLayout` 的单页完整格线和 glyph placements，不测字、不换行、不分页。显示比例由 `widthPx / page.widthMm * zoom` 决定，DPR 只调整 backing bitmap；先预检全部资源/墨迹，再画白色 A4、线段和字形。
2. 线段逐条按可信 width/gray/dash/cap/join 绘制，墨迹边界按实际方向/cap 计算，不把中心线框当裁剪框。字形从 T04 glyphOutline 读取，在核心已包含 offset 的 baseline 处用 `fontSizeMm / UPEM` 缩放并翻转 y；不得二次施加偏移或改变字号。实际 glyph ink 与核心输出核对。
3. `miniprogram/components/paper-canvas` 封装原生 `type=2d` Canvas，通过方法接收 layout/provider，避免把大布局和正文放入 setData；仅传显示尺寸、状态与无正文计数。只绘制当前页，渲染请求有顺序标记，离页清空引用。
4. `miniprogram/lib/font-loader` 只接受可信静态配置的资源 URL 或 `USER_DATA_PATH/learn-fonts/<sha>.ttf`，按模板需要加载字体，复用最近 provider 和同键在途请求。T04 校验全部原始字节；失败显示明确状态，不使用系统字体。生产 URL/域名/CloudBase 留最终配置。
5. 开发诊断页独立于 P01-P08。官方 automator 工具通过本机已有原字体分块传输至模拟器内存，再一次写入私有文件（避免大文件重复 append 的模拟器存储限制），随后驱动四模板空白、真实方格/拼音文字与描红、缩放和错误恢复并截图；无公开资源服务，不提交字体或截图生成物。
6. 根 build 由本任务适配为单份共享 font-metrics 运行时，按每个输出 entry 计算相对 require，避免假定微信支持绝对路径；保留已有双目标 runtime diagnostics。T04 已独立检查，本任务不修改其实现。

## 改动边界

新增 renderer、其测试、Canvas 业务组件/字体加载器及独立诊断页/脚本；根 scripts/build.mjs 已由主会话授权本任务维护。核心排版/T04 由并行任务负责；正式导航和编辑流程留 T18。模拟器证据与手机、真实字体分发许可及实体打印明确分开。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

依赖真机字体加载能力；开发工具截图不能替代真机验收。

## 依据

- [PAPER_ENGINE](../../../../../docs/PAPER_ENGINE.md)
- [ARCHITECTURE](../../../../../docs/ARCHITECTURE.md)
- [PAPER_PRESETS](../../../../../docs/PAPER_PRESETS.md)
- [TESTING](../../../../../docs/TESTING.md)
