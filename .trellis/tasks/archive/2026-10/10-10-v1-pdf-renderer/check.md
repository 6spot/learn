# T09 独立检查

日期：2026-10-11。检查范围为 PDF renderer 源码、构建、TTF 只读解析、字体/许可证嵌入、两目标便携性及十二份合成样张；未扩大 T10 的光栅量测和实体打印范围。

## Findings (fixed)

- File: `packages/pdf-renderer/src/index.ts`、`test/pdf.test.mjs`
  - Issue: 原字体字节校验后仍引用 provider 返回的可变数组，首个 await 后若其共享缓存变化，最终 FontFile2 可嵌入未通过校验的字节。独立复现中输出成功但解压字体 SHA-256 与 pin 不同。
  - Fix: 校验类型/大小后先复制字体字节，再进行 hash、TTF 解析与嵌入；新增回归在异步期间将 provider 原 buffer 清零，最终解压字节/hash仍与原始字体完全一致，provider只读取一次。
- File: 任务 PRD/design/implement/evidence、JSONL 清单与包 README
  - Issue: 需要同步实际落地目录、新增回归和独立检查状态；AC3 整项勾选容易把本地资源检查误写成真实云端验收。
  - Fix: 更新为十一项测试、563366B共享包体，说明字体字节所有权，并单列 T10/T24 最终验收项。

## Findings (not fixed)

无遗留局部实现缺陷。已核对低层 CIDFontType2/Identity-H/Identity CID-to-GID、完整 FontFile2、实际 hmtx 宽度、原许可证附件和无用户正文元数据。坐标按 72/25.4 转换，y-down 仅在页面坐标处转换为 PDF y-up，glyph 逐个使用 core 原点，不重排或重复 shaping 偏移。线段独立描边，保留 cap/join/miter/dash/gray，不对中心线框裁剪。

既有已确认边界和后续责任：

- 无原 Unicode 文本的 layout 不能可靠生成全部 ToUnicode 映射；按已冻结设计保证可见字形/打印，不保证复制/文本提取，不新增正文存储。
- 64 MiB/50页/100000 glyph 是本地实现硬上限，不能当作真实 CloudBase 或微信可用容量。正式限制、字体许可、完整光栅公差和实体打印仍归 T10/T24。
- `.trellis/spec/` 的 PDF契约与“先拥有字节再校验和异步使用”规则由主会话同步，避免并发修改规范。

## Verification

- Lint：未配置独立 lint；作用域 diff --check、文本尾空白、本地链接/JSONL 目标及 runtime 平台调用/动态求值检查通过。
- TypeCheck：通过，包测试/样张命令均执行 strict TypeScript 构建。
- Tests：`npm --prefix packages/pdf-renderer test` **11/11**，包含字体原件/附件解压hash、A4尺寸、逐glyph绝对Tm、限制/安全错误及两个无宿主API VM。
- Samples：`npm --prefix packages/pdf-renderer run samples` **12份**；pdfinfo/pdffonts独立核验 A4、页数、无PDF JavaScript及完整CID TrueType嵌入；最大18423109B。
- 未提交或归档。
