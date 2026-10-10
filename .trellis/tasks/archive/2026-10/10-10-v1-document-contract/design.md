# T03 设计边界

> 状态：2026-10-10 执行前技术设计。本任务冻结可执行契约与校验；完整方格/拼音排版由 T05/T06 完成，正式字体/样张发布由 T10 验收。

## 责任与依赖

packages/paper-core 的文档、布局与预设边界。

前置交付：[T01 建立开发与回归基线](../10-10-v1-baseline-runtime/prd.md)

## 实现边界

1. 对照现有 SquareTextDocument/DocumentLayout 梳理最小演进方案。
2. 明确预设提供的默认文字规则与可扩展布局结果。
3. 迁移现有调用并验证旧基准；记录单位、精度与序列化边界。

### 本轮实现方案

- 差距在核心输入与输出边界：旧 SquareTextDocument 把预设和用户内容混合，缺少明确版本/样式、原文映射与 glyph 契约。新增 contracts/document/errors/font-metrics 模块，保留旧导出供现有回归使用；不在渲染器补排版或默认值。
- `PaperInput` 只接受 templateId、原始 title/body、tracing 与 options；options 为 titleAlign=left/center/right、bodyIndent=default/none，与 D-043 已接受 UI 一致。拒绝未知字段及用户几何/字体/字号覆盖。
- `TrustedPaperPreset` 包含不可变版本组合、固定几何、默认选项、文字/线条样式、独立方格或拼音承载参数及资源限制。几何必须与 PAPER_PRESETS 当前固定源码完全一致（版本号除外）。默认恢复从可信预设读取，不把临时用户输入写回预设。
- 标题/正文原始 UTF-16 字符串保留，不 trim、不 normalize、不统一行结束符；显式段落记录原始 source span 和 CR/LF/CRLF separator span，包括首尾空段。连续空白导致的 blank 模式只影响绘制，不丢失输入或段落。
- 固定 `unicode-segmenter@0.17.3` 作为两端唯一 grapheme 拆分实现，无系统 Intl.Segmenter 分支；输入安全校验先拒绝孤立 surrogate、非换行控制字符和明确资源超限，不截断。独立普通空白函数不依赖系统 Unicode 属性版本。
- FontMetricsProvider 同步 shape(fontId,text)，输出 glyph ID、原输入 UTF-16 cluster span、font-unit advances/offsets、精确轮廓 ink bounds（y 向上）、unitsPerEm 和固定 ascender/descender。无 .notdef 或系统字体回退；T04 负责真实字体实现。组合字符可在 shaping 内规范化，但返回索引必须映射原字符串。
- 新 PaperLayout 契约提供毫米页面/行/逻辑占位/glyph baseline origin/ink bounds/字体样式引用；字体单位到毫米统一转换，y 方向翻转明确，数值舍入到 1e-6 mm，渲染器不再决定 baseline/换行/分页。
- 描红与填字共用 canonical filled 字体的逻辑布局；田/米中文 glyph 渲染字体才改为霞鹜文楷 GB。字形放不进既定 slot 时返回结构化错误，不能缩格或新增替代布局。
- 开发候选样式：essay 7mm、tian/mi 10.5mm、pinyin 8mm em-size；拼音 baseline 在第一线下 8mm，默认缩进 2 个单位，方格单位为 cell、拼音单位暂用 4mm。填字灰度 0、描红 .65、主线 .2mm/灰度 .55、辅助 .1mm/灰度 .75（2/2mm dash）；这些仅为版本标记 development-candidate 的开发输入，T10 校验前不得作为生产 active。
- 结构化 PaperError 只返回固定 code、字段名、UTF-16 位置与资源上限；错误 message 不插入正文、布局或未知异常信息。尺寸/字体资源非法时停止，不返回部分布局。

本轮文件范围：paper-core src 的契约/校验/转换与测试、package/lock 的固定分词依赖，runtime-smoke 的 native/bundled 能力语义跟进。root 脚本/配置和字体/云端包由其他代理负责。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

文档中的字段名/毫米协议有提议性质；依据现有实现完成技术设计，不误称其已冻结。

## 依据

- [PAPER_ENGINE](../../../../../docs/PAPER_ENGINE.md)
- [ARCHITECTURE](../../../../../docs/ARCHITECTURE.md)
- [PAPER_PRESETS](../../../../../docs/PAPER_PRESETS.md)
- [TESTING](../../../../../docs/TESTING.md)

## 跨任务接口归属

明确 D-040 对齐/缩进的允许输入、缺省/重置来源；用户输入与可信几何/文字/线型预设分离。布局输出包含供两渲染器一致使用的字体/样式引用、定位约定及结构化错误；渲染器不另定默认值或分页。 阶段输入见 [执行清单](implement.md)。
