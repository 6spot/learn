# T05 设计边界

> 状态：2026-10-10 执行设计；已与主会话确认 D-047 复杂标点规则，使用真实 T04 字体 provider。

## 责任与依赖

packages/paper-core 方格布局与回归样例。

前置交付：[T03 完善通用文档与布局契约](../archive/2026-10/10-10-v1-document-contract/prd.md)、[T04 接入共享字体度量](../archive/2026-10/10-10-v1-font-metrics/prd.md)

## 实现边界

1. 从现有测试提炼未覆盖边界并复现问题。
2. 实现已确认规则可覆盖的最小修正；新的标点产品取舍先形成决策样例。
3. 更新布局基准并执行纸张核心完整测试。

### 本轮方案

- 新增 `layoutSquarePaperDocument(PaperDocument, FontMetricsProvider): PaperLayout`，三种方格共用同一个实现。输入重新经 T03 构建；可信字号/几何不由用户覆盖。旧 layoutSquareDocument 暂留历史基准，不作为新渲染入口。
- layout 分成公开原文 token、不可拆标点组、按行分配逻辑 slots、字形绘制坐标四步。canonical filled 字体决定所有宽度/行页，tracing 只在田/米汉字 glyph 绘制时换霞鹜文楷 GB。space/拉丁/数字按真实 shaped advance 与完整 ink 外延分配，长词超过整行才按 grapheme 拆分；每个续行片段重新 shape。
- 方格汉字/CJK 标点使用固定 cell；普通字形按精确 ink 居中放入 slot，拉丁各 run 在同一行共用基线且保护 ink overhang。所有实际字形按 T03 positionShapedText 校验，不整体缩字/裁字/缩格。
- D-025 七种点号在末格紧接汉字且无独立格时，唯一采用末格右下角三分之一格位、字号三分之一的独立 slot；原汉字不移动。其他点号照常独占格。
- D-047：开引号/括号与后续单元绑定，闭引号/括号与前单元绑定（停止点号之后不回挪汉字）；常见成对符号不会因自动换行孤立。连续点号保留各自 source range；中文成对省略号/破折号保留双字符原文并作为两格组。末格 Han+共享点号之后继续点号或闭符号而无法安全容纳时明确 UNSUPPORTED_TEXT；不新增第二点号策略。
- 对首尾显式空段逐行分配，包括空白新页；全输入无可绘制字仍为一张 blank 格纸。title/body gap 来自可信预设，仅两块都非空时使用；标题逐视觉行按 left/center/right 对齐，正文每逻辑段首行按 default/none 缩进。
- 输出完整几何、行/段落/原文 span、slots、实际 glyph/font/style/baseline/ink；运行结束前深冻结。达到 maxPages 直接拒绝，不返回部分布局。
- 增加合成固定布局基准与 T04 原字体集成，覆盖三模板填字/描红、普通标点组、长词/小数/空格、全部显式空行、极端页边界和缺字/资源/尺寸拒绝。真实字体测试仅读测试资产，纯 TS 核心不依赖文件系统或 fontkit。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

O-003 中尚无明确答案的复杂标点行为需要样例与决策；已确认规则的修复不等待全部问题关闭。

## 依据

- [PAPER_ENGINE](../../../docs/PAPER_ENGINE.md)
- [PAPER_PRESETS](../../../docs/PAPER_PRESETS.md)
- [TESTING](../../../docs/TESTING.md)
