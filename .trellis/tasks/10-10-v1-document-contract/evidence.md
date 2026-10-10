# T03 验证证据

日期：2026-10-10。本任务完成文档/预设/度量/输出契约及可执行校验；没有以契约类型冒充完整方格/拼音排版。

## 实际检查

- `cd packages/paper-core && npm install --save-exact unicode-segmenter@0.17.3`：固定 MIT 分词依赖，audit 0 vulnerabilities。
- `cd packages/paper-core && npm test`：独立复查修复后 TypeScript 编译与 **41/41** 通过，包含原有 22 个几何/基础布局基准及 12 个文档边界、7 个字形换算检查。
- 根目录 `npm test`：独立复查修复后严格类型检查、core **41/41**、runtime-smoke **13/13**、并行 cloud-runtime **25/25**，共 **79** 通过。双端测试在完全没有 Intl、Array.at 与 Unicode 属性正则的 VM 中生成相同文档，保留原文与最后空段。
- 独立复查修复后，根 `npm test` 构建完成，再运行 `node scripts/test-devtools.mjs --diagnostics`：开发者工具基础库 3.17.3、模拟微信 8.0.5 的 **11 项**诊断、原生按钮重跑及 **0 个**应用异常检查通过。此前完整 `npm run test:devtools` 入口也已通过。此证据是开发者工具模拟，不是 iOS/Android 真机。
- `git diff --check` 与本任务/README 相对引用检查通过。

独立检查修复：输入/预设访问器与隐藏序列化钩子可能改变快照，虚线数组空洞会被 JSON 静默变成 null；字形缺损记录可能抛原始 TypeError，有限数值换算/舍入仍可能溢出为 Infinity。现在按稳定数据属性校验、验证 source/font/style 绑定，并对非有限输出明确拒绝。三组新增回归涵盖这些实际边界；没有修改公共接口、字体 provider、已有物理几何或增加 UI 选项。

## 覆盖

- 客户端不得传几何/字体/灰度/内部模式/版本字段；未知字段拒绝。UI 仅有 titleAlign 三值与 bodyIndent default/none，默认/恢复来自可信预设。
- 四套固定几何所有坐标保持一致，哪怕修改后仍能铺满 A4 的另一套尺寸也拒绝；版本、carrier、样式、线型与限额结构无效时拒绝。
- 输入不 trim、不 normalize、不合并 CRLF/LF/CR；grapheme 记录原 UTF-16 半开区间，显式前后空段和 60 个尾换行全部保留；后续页分配消费这些记录。
- 固定分词实现覆盖组合重音、家庭 emoji、旗帜、肤色、Indic conjunct、扩展汉字/variation selector。缺原生 Intl 或错误原生 Segmenter 时仍产生同样布局；旧布局的 Unicode 属性正则限制仍单独报告。
- 快照深冻结且与调用方后续修改隔离；空白模式保留输入；填字/描红共享段落/选项。
- 字体坐标 y-up 到毫米 y-down 的 baseline/offset/advance/ink 换算、组合 mark 零进位、space 无墨迹、source span 覆盖和 run ink union 一致性；.notdef、越界、无穷/NaN、错源区间明确拒绝，不缩字/裁字。
- PaperError 只携带固定 code 和安全位置/上限，未知异常的 message 不流入公开错误。

## 下游契约与限制

具体 API、原文映射、单位和错误说明唯一维护在 [paper-core README](../../../packages/paper-core/README.md)。FontMetricsProvider 已与 T04 代理直接确认，导出在 `font-metrics.ts`；真实字体数据与 shaping 实现在 T04，不在这里造模拟生产 provider。

`getDevelopmentPreset` 的候选字体/线条/拼音参数和版本详见本任务设计及源码；candidate 不能自动成为生产 active。`PaperLayout` 定义正式渲染输入，`positionShapedText` 是实际换算函数；T05/T06 才负责按这些输出契约生成完整方格/拼音页面。旧 layoutSquareDocument 为现有回归暂留，未把尾空行页面分配或复杂标点不足误标完成。

按 D-044，真机、CloudBase 配置、字体许可/字形/墨迹/实体打印继续移交 [最终验收](../../../docs/FINAL_ACCEPTANCE.md)。主会话负责独立检查、提交及生命周期；实现代理没有提交或推送。
