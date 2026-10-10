# T04 设计边界

> 状态：2026-10-10 本地执行设计。资源使用 T02 原始候选；生产分发、微信设备和打印条件单独保留。

## 责任与依赖

共享字体度量模块、版本固定的度量数据。

前置交付：[T02 字体资源与授权验证](../archive/2026-10/10-10-v1-font-resources/prd.md)、[T03 完善通用文档与布局契约](../archive/2026-10/10-10-v1-document-contract/prd.md)

## 实现边界

1. 新增 `packages/font-metrics`，仅接收加载适配器交给它的 `Uint8Array`，包内不接触文件/网络/微信 API。复用 paper-core 已导出的 `FontMetricsProvider` / `ShapedText` / `GlyphMetrics`，不复制接口，不由渲染器独立测宽。
2. 对比 fontkit 浏览器构建和 `@pdf-lib/fontkit` 固定版，先实测规范分解、源 grapheme 映射与浏览器打包；若动态代码生成或 Node 内置依赖不适合微信，则不能凭 Node 测试通过宣称可用。SHA-256 使用浏览器兼容实现，校验官方原始 TTF 全量字节；三字体 ID 与候选集合从 T02 清单派生生成，不维护另一份可漂移散列。
3. Provider 持有私有原始字节副本，只接受已支持的候选组合，验证未知 ID/版本、缺失/损坏资源并返回不含正文的结构化错误。API 返回完整原始 UTF-16 grapheme 范围、font-unit advance/偏移、精确轮廓外接框。hhea ascent/descent 作为统一元数据；布局须使用真实 ink bounds，不能用 ascent 替代边界。
4. 规范等价组合支持以最终共享 shaping 路径实测为准；`Ǹ` 不因 cmap 缺失提前拒绝，需最终无 `.notdef` 且保留原始簇映射。对未支持的变体选择符/ZWJ/控制符明确拒绝，不能无声去掉；跨 grapheme 连字映射须可追溯，不能用 glyph.codePoints 猜源偏移。
5. `shape` 输入横向单行文字，布局负责换行/分页和比例转换。提供复用 provider 的毫米测宽适配，以及可选只读字形轮廓指令供 Canvas/PDF 共用。轮廓不在此任务作为最终 PDF 嵌入许可结论，不导出子集或修改字体。
6. D-031 的普通字体负责逻辑宽度与换行，描红字体仅在核心已分配的位置绘制；接口不根据描红开关重测逻辑布局。主会话/核心任务负责正文分页集成，此包通过真实字体测试验证度量及对接。
7. 测试实际原始字体的中英数、空格、90 个合成拼音簇、源偏移、字形边界、临界宽度、资源失败、确定性及隔离输入；构建浏览器 ES2017 与云端目标，检查无 Node 内置导入/动态代码执行，并在无宿主测宽 API 的沙箱比较结果。不能把这些模拟验收写成真机或最终打印通过。

## 实测后的库与数值方案

- 选择固定 `fontkit@2.0.4` 浏览器入口，SHA-256 为 `@noble/hashes@1.8.0`，完整 grapheme 分段为与核心一致的 `unicode-segmenter@0.17.3`。`@pdf-lib/fontkit@1.1.1` 比较后未采用，避免其遗留动态函数回退。包产物统一浏览器解析后再转两目标，不能让云端重新解析到 fontkit 的 Node 文件入口。
- Fontkit 不自动做拉丁规范分解；在原 grapheme 内先 NFC，缺字时只接受全部 NFD 组件可用的规范等价表达，最终还检查 `.notdef` 与输出码点来源序列。无法验证的重排/一对多映射明确失败，不猜偏移。
- Fontkit `path.bbox` 的二次转三次求根在 LXGW 25 个字上有误差。改为由原始 `path.commands` 直接计算二次曲线极值、稳定三次求根。独立 FontTools 全部 14,019 条 glyph ID/advance/精确边界摘要验收，不用库自身结果当预期。
- Fontkit / restructure 存在宿主 TextDecoder/Encoder 引用。构建通过 esbuild lexical inject 绑定包内 UTF-8、UTF-16、ASCII/Windows-1252 实现，不改全局；这不是通用编码框架，其他旧编码明确不支持。无宿主编码器 VM 与标准编码器差异样例验证该路径。
- `originalFontBytes` 返回未修改 TTF 的防御副本，供后续 PDF 原字体完整嵌入；`glyphOutline` 供 Canvas 统一字形绘制。轮廓 API 不替代 PDF 字体嵌入要求，也不关闭 MiSans 子集许可待验项。

## 改动边界

新增包的源码、依赖/构建、测试、资源元数据生成及 README，更新 T04 任务证据。T02 正由独立检查员审查，本任务不改其文件；paper-core 接口和布局由另一实现者负责，根脚本由主会话协调。此处不写加载服务、不改纸张规格、不改用户输入、不设生产字体交付策略。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

候选资源可用于开发验证；正式交付仍需 T02 授权结论及 T10 样张验收。

## 依据

- [PAPER_ENGINE](../../../docs/PAPER_ENGINE.md)
- [ARCHITECTURE](../../../docs/ARCHITECTURE.md)
- [TESTING](../../../docs/TESTING.md)
