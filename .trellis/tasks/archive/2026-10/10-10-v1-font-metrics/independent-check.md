# T04 独立质量检查

日期：2026-10-11。责任范围为字体包及证据、根 test:fonts 单独命令；保留正在进行的 T05/T08/T12 开发，没有修改字体二进制、纸张核心、字体接口或云端业务。

## 已修复

- **来源与调用顺序**：Fontkit 原生 glyph cache 留存首次 codePoints；`glyphOutline(A)` 后 `shape(A)` 在三字体上均会错误拒绝，LXGW 共享 glyph 的 `-`/`U+2011` 也受影响。增加实例局部 public getGlyph 适配，缓存仅提供几何；来源、mark/ligature 标记每次独立。不修改私有 cache、全局或字体字节；unicode-properties 1.4.1 与上游相同版本显式固定。
- **宽度溢出**：有限字号也可能在毫米换算中溢出为 Infinity；适配器校验 run 度量和换算结果，固定错误码拒绝。
- **回归入口**：根目录 `npm run test:fonts` 执行包构建及真实字体检查，不将并行云服务草稿加入检查范围。

## 验证

- `npm run test:fonts`：严格 TS 编译及 **17/17** 通过；失败复现用例已先观察到 FONT_SHAPING_UNSUPPORTED，再验证修复。
- 全部 **14,019** 字形记录继续符合独立 FontTools BoundsPen/hmtx 摘要；独立生成器补充 **37** 组 cmap 别名，正反输入顺序和不同 provider 得到相同结果。
- **270** 个拼音簇的 NFC/NFD、缺 cmap 的 `Ǹ`、补充平面及原 UTF-16 来源范围通过；轮廓先读后的 mark/alias 路径也纳入无宿主编码器 VM。
- 字体大小/SHA-256 从原始清单生成且测试核对；原始文件和返回副本相互隔离，缺失/损坏/不支持序列显式拒绝，无系统字体回退。
- 两目标均从浏览器解析后的 **385,116 B** 同一 artifact 构建；无外部 runtime import，无动态代码调用。VM 没有 Buffer/process/DOM/Intl.Segmenter/TextEncoder/TextDecoder，禁 eval/Wasm，真实字体 shape 结果一致。
- 差异空白及脚本语法检查通过。未配置独立 lint 命令，不把构建警告或未执行 lint 写成通过。

## 未修复与验收限制

无剩余本任务代码发现。Fontkit 未使用的 variable-font STAT 表存在上游 duplicate axisIndex 警告；输入只接受散列固定的静态字体，保留警告记录，不修改上游未使用实现。

当前三字体 `fi`/`ffi` 等默认拉丁探针仍为独立 glyph；多源 glyph 的协议实现不等于已经验收未来字体全部连字/复杂重排。无法可靠映射的形态仍拒绝。字体真实设备加载与内存/性能、PDF 集成、生产字体交付许可、署名及实体打印保持最终门槛；本检查没有分发字体、修改正式页面或宣称字体真机验收通过。

规范建议交主会话：来源 metadata 不能随 glyph ID 的几何 cache 复用；共享浏览器字体 artifact 与包内 lexical codecs 是两端一致性边界。未提交代码。
