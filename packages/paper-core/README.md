# Paper Core

纯 TypeScript 纸张几何、文档与共享排版契约，不依赖微信 API、Node 文件系统、Canvas 或 PDF 库。固定纸张规格见 [PAPER_PRESETS](../../docs/PAPER_PRESETS.md)，业务边界见 [PAPER_ENGINE](../../docs/PAPER_ENGINE.md)。

```sh
npm install
npm test
```

## 文档边界

```ts
const preset = getDevelopmentPreset('essay-grid'); // 仅本地开发候选
const document = createPaperDocument({
  templateId: 'essay-grid',
  title: '合成标题',
  body: '第一段\r\n\r\n第二段\n',
  tracing: false,
  options: { titleAlign: 'center', bodyIndent: 'default' },
}, preset);
```

`PaperInput` 仅含模板、标题、正文、描红及两项已确认设置；`titleAlign` 为 left/center/right，`bodyIndent` 为 default/none。默认与重置值由 `getDefaultTextOptions(preset)` 提供。`createPaperDocument` 校验后快照并深冻结可信预设与输入；原始字符串、CR/LF/CRLF、前后空白、Unicode 表示与输入顺序保持不变，不执行整理换行。

输入和预设只接受稳定的 JSON 数据属性，拒绝访问器、隐藏序列化钩子和稀疏/非标准虚线数组，避免校验后的快照改变含义。

`TrustedPaperPreset` 必须由可信调用方提供，不能从用户请求中读取。验证结构与固定几何不等于鉴权；云端仍要从可信版本注册表重建。其 `stage` 也不是授权凭据。`getDevelopmentPreset` 返回的字体尺寸、灰度、线型及拼音基线明确属于 development-candidate，正式发布须完成 T10/T12，不提供用户选择这些参数的入口。

每个 `TextBlock` 保留 `sourceText` 与 `paragraphs`。段落记录正文 span、原始 separator 及 separator span；每个 grapheme 的 `SourceRange` 是所在标题/正文字符串中的 UTF-16 半开区间 `[start,end)`。末尾换行后仍有空段落，提供给 T05/T06 分配空白行和跨页；本契约解析器不自行生成页面。空白模式仍保留完整输入。

分词固定使用 `unicode-segmenter@0.17.3`，属于引擎版本的一部分，两端不依据 Intl.Segmenter 的存在选择另一种算法。孤立 surrogate、非换行控制字符和资源超限明确拒绝，不截断或替换文字。默认技术上限由 `DEFAULT_RESOURCE_LIMITS` 提供，可由可信预设降低或经验证调整，不提供客户端覆盖。

## 字体与绘制契约

`FontMetricsProvider.shape(fontId,text)` 使用已加载的同版资源，返回 `ShapedText`：原始 UTF-16 cluster 映射、glyph IDs、font-unit advances/offsets、unitsPerEm 与精确轮廓边界。字体单位以基线为原点、y 向上；允许 provider 在 shaping 内处理规范等价 Unicode，但所有返回索引必须映回原输入。无 .notdef 或系统字体回退。

`positionShapedText` 将这些结果转换为 `GlyphPlacement`，页面单位毫米、y 向下、精度 `1e-6 mm`。origin 已包含 shaping offset；渲染器按输出字体/glyph ID/style ID/em-size/基线绘制，不再定位或测宽。函数验证 cluster 覆盖、advance 与 ink union 一致性；给定 slot 约束时，任何字形越界直接报错，不自动缩字、裁字或改变格线。

缺损 glyph 记录、无效 source/font/style 绑定以及换算/舍入中的数值溢出均返回 `INVALID_FONT_METRICS`，不会返回带非有限坐标的局部结果。

`PaperLayout` 给 T05/T06 提供唯一正式输出形状：版本组合、完整每页几何、行/段落映射、逻辑 slots、glyphs、同版文字/线条样式。填字和描红必须用 canonical filled 字体做同一次逻辑布局；田字格/米字格的中文绘制才使用相应 tracing 字体。真实 provider 由 `packages/font-metrics` 实现；渲染器不能提供自己的分页测宽。

`layoutSquarePaperDocument(document, metrics)` 已将三种方格接入真实 `PaperLayout`：标题对齐、段首缩进、真实英数字宽、长词续行、点号共格、括号/引号绑定及完整尾空行分页。D-025 仅允许末格共享点号使用三分之一字号和右下角格位，其他文字不自动缩放；D-047 的无法安全容纳边界返回明确错误。`metrics` 由 T04 已加载原字体资源的 provider 提供，核心不读取字体文件。

`layoutPinyinPaperDocument(document, metrics)` 独立实现四线行带：第三线固定基线、真实宽度及左右 overhang、连续非空格片段优先换行、超长片段按完整字符簇续行、标题/缩进/原始空白和自动续页。填字/描红使用相同 MiSans Latin 字形定位。候选字号7.4mm支持已量测大小写调号；重复调号、错误 ü/ê 修饰、汉字或其他不可表示字符明确拒绝，不转换或修剪输入。

目前保留旧 `layoutSquareDocument` 给既有基准和 T01 smoke 使用，它不是新渲染入口。

实际字体验证与合成基准：

```sh
npm run test:integration
npm run baseline:square
npm run baseline:pinyin
```

`test:integration` 先构建相邻 font-metrics 包，需要该包依赖和 assets/fonts 原字体资源已经安装/恢复；通过原字体 glyphOutline 验证四模板填字/描红、拼音NFC/NFD等价、升降部/调号与墨迹。`baseline:square` / `baseline:pinyin` 只在主动接受版式变更时执行，更新后审查对应 `test/fixtures/*-layout.json` 差异；日常 `npm test` 比较已存基准，不自动覆盖。

## 版本与布局摘要

新预览/云端入口使用 `layoutPaperDocument(document, metrics)`，按模板选择同一版本的方格/拼音布局。`PAPER_ENGINE_VERSION` 是当前包实际实现的算法版本；旧内核必须保留其真实构建包，不能给当前代码挂旧版本标签。`validateLayoutVersions` 返回四字段不可变副本，`assertLayoutVersionsMatch` 检查完整组合，`assertLayoutVersionsSupported` 额外检查可信支持列表和当前可执行内核。云端T12仍拥有发布/retire/引用保护的权限与状态，核心列表不是授权。

```ts
const layout = layoutPaperDocument(document, metrics);
const digest = createLayoutDigest(layout);
// 云端从可信预设和原始参数重新计算后：
assertLayoutDigestMatches(recomputedLayout, digest);
```

`serializePaperLayout` 用显式完整schema生成ASCII规范JSON（按key排序、数组顺序保留、-0为0、拒绝非法/缺少/未知字段和非有限数值）。标题/正文style ID必须唯一，每个glyph必须引用其source.block对应的style；未知或错块引用不能生成有效摘要。`createLayoutDigest` 使用固定SHA-256，返回 `learn-layout-v1:sha256:<64位小写hex>`；`validateLayoutDigest` 拒绝未知协议和额外空白。坐标采用已有1e-6mm精度，序列化不二次舍入/缩放，完整字号/灰度精度保持。版本、每页几何/线段、源范围、占位、字形、坐标/advance/墨迹及全部绘制样式均参与。

这些函数不依赖Node、系统编码器、原生crypto或渲染器。摘要区分 `LAYOUT_DIGEST_INVALID` / `LAYOUT_DIGEST_MISMATCH`，版本不可执行为 `UNSUPPORTED_VERSION`，资源失配和加载失败继续使用已有错误。摘要用于预览一致性，不能代替鉴权、云端复算或T14参数HMAC；空白输入可生成相同布局摘要，但参数指纹仍须区分原始输入。规范布局虽无原文字符串，仍含敏感字形/源映射，不能写日志或长期保存。

根目录 `npm run test:runtime` 用实际两端构建和真实字体在无Node/编码器/Intl的隔离VM中比较四模板完整规范串/摘要；协议固定向量在 `test/layout-protocol.test.mjs`，引擎/协议变更需主动评审更新，不能静默重写金样。

## 错误与验证

`PaperError` 只携带固定 code、字段、UTF-16 offset 或上限。`safePaperFailure` 将未知异常转换为固定内部错误，不把正文、完整布局、字体 payload 或原异常 message 放进公开错误/日志。

核心测试覆盖可信边界、四模板几何不变、默认设置、Unicode/显式空行/尾空段、深冻结与资源限制、字体单位到毫米转换、组合字形 ink/cluster 与显式越界。根目录运行时回归另外比较小程序/云端构建产物；微信基础库、实际字体、PDF 与实体打印分别取证，不混作纯 TS 检查通过。
