# T04 本地实施与验证 — 2026-10-10

新增 [packages/font-metrics](../../../../../../packages/font-metrics/README.md)，同一固定浏览器实现供本地预览和云端复算。对齐 T03 `FontMetricsProvider`，不修改接口/核心源码；无字体二进制、子集、云端加载配置或宿主页面改动。

接口为 `createFontMetricsProvider`、`shape`、`glyphOutline`、`originalFontBytes`、`createMeasureTextMm`。ID/散列从 T02 清单生成，候选组合 `learn-fonts-2026-10-10-candidate.1`，算法 `fontkit-2.0.4-nfc-grapheme-map-v1`。未来更改资源/度量须更新受支持组合，不作为远端 JS 热更新资源。

## 实际检查

```sh
assets/fonts/.venv/bin/python packages/font-metrics/tools/generate-reference.py
npm --prefix packages/font-metrics test
npm --prefix packages/paper-core test
```

- 本包独立检查修复后 **17/17** 通过，含 TypeScript 编译；实现阶段核心 **41/41** 通过，独立检查未改正在开发的 T05 核心源码。
- FontTools 4.60.1 `BoundsPen` + `hmtx` 独立生成 14,019 个 glyph 记录摘要：LXGW 6,928、MiSans 6,927、MiSans Latin 164。所有 GB2312 汉字及 ASCII/拼音经实际 provider/outline 后，glyph ID、advance 和 1e-6 font-unit 边界全部匹配。基准仅含公开合成码点和汇总散列，不分发轮廓。
- 每个字体 90 种大小写/四声组合，合计 **270 簇** 的 NFC/NFD 数值形状一致，无 `.notdef` 且保留原始 UTF-16 区间。MiSans `Ǹ` 使用两个 glyph，仍映射同一原始簇；`𠮷` 不拆 surrogate pair。
- 独立 HarfBuzz 校对：`AV` advance 1261；`3.14` 为 573 + 179 + 371 + 591 = 1714，包含真实字距和比例数字。实际字体宽度驱动的行尾临界测试通过。
- 实际 shape 通过 T03 `positionShapedText`，含 `Ǹ`、NFD、多字中英数；源区间、offset、ink union 和毫米转换一致。描红字体变化不进入 canonical 测宽，逻辑位置保持一致。
- 版本、资源缺失/损坏、未知 ID、缺字、变体/ZWJ/控制符和资源被修改均明确拒绝/隔离；无正文错误日志或系统字体回退。
- 浏览器/云端 VM 比较不提供 Buffer、process、DOM、Intl.Segmenter、TextEncoder、TextDecoder，并禁止动态代码及 Wasm；三份真实字体仍一致。独立检查后 bundle **385,116 B**，0 外部运行时 import，无 `eval`/`Function` 调用。
- 未改物理几何或最终字号；`git diff --check` 和本包/任务相对引用检查通过。

## 检查中修复的问题

1. **精确曲线边界**：fontkit 把二次转为近退化三次曲线再求根，LXGW 25 字极值不准确（“蔹” xMin=65.0625，而 FontTools 为 63.6）。本包直接求二次极值、稳定求三次根；14,019 独立记录全通过，不改为控制框或放宽纸张边界。
2. **规范等价与来源**：fontkit 不自动分解缺 cmap 的 `Ǹ`；glyph 数量不能当作 UTF-16 长度。本包在原 grapheme 内规范化并验证输出码点来源，不支持的重排/一对多明确失败。
3. **宿主编码器**：fontkit/restructure 初始化引用 TextDecoder/Encoder。构建注入只在包内使用的 UTF/ASCII codecs，未改全局；正常/损坏字节与原生行为对照通过。基础检查员实际 DevTools 3.17.3 虽报告编码器存在，本实现不依赖它。
4. **字形缓存来源污染（独立检查）**：Fontkit 按 glyph ID 缓存首次调用的 codePoints。先读取轮廓后 shape 会让字母 A 被拒绝，共享 glyph ID 的 LXGW 字符也会使结果依赖调用顺序。实例内 public getGlyph 适配保留几何缓存、为每次 cmap/GSUB 调用分配独立来源与 mark 标记；37 组别名、相反顺序、跨 provider 和规范等价表示复测通过。
5. **测宽溢出（独立检查）**：极端有限字号会产生 Infinity。毫米适配器现在拒绝非法度量和非有限计算结果，不能把错误宽度交给排版。

2026-10-11 独立检查详情见 [independent-check.md](../independent-check.md)。新增根 `npm run test:fonts` 仅运行字体构建/检查，不引入仍在开发的云端任务。

## 剩余门槛

- 上游 fontkit 未使用的 variable-font STAT format-1 定义含重复 `axisIndex`，esbuild 有警告；接受的全部是散列固定静态 TTF，未开放 variable-font，不全局屏蔽警告。
- 三字体约 34 MB，受限 VM 创建/散列校验约 28 秒，不是手机性能验收。按模板只加载所需资源，真实适配器仍测延迟、内存、UI 响应，不能缩减成样例字库。
- 此版本拒绝变体选择符/ZWJ、行控制符和无法可靠映射的形态；保留输入并明确报错。布局负责分行调用，无隐式改文或正文持久化。
- Canvas 使用统一 outline；PDF 后续仍须嵌入原始字体并按 glyph ID/位置绘制，不用轮廓替代嵌入。MiSans 子集/生产交付许可、署名、微信真机、儿童笔形与打印保持最终待验。
- 独立检查、状态与总文档由主会话收尾。本轮未提交、归档或发布。
