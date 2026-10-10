# T10 数字打印交付独立检查

2026-10-11，reviewer：`foundation_check`。范围为 `scripts/print-acceptance/`、`docs/PRINT_ACCEPTANCE.md` 和 T10 证据；没有改生产布局、渲染算法、字体文件/候选 stage，没有操作 DevTools 或 `dist/miniprogram`。

## Findings (fixed)

- File: `scripts/print-acceptance/generate.mjs`, `measure.py`, `test_measure.py`
  - Issue: 生成器静态导入字体 fixture/构建产物，量测器顶层导入 Pillow；这些依赖加载失败时，旧 `manifest.json` / `measurements.json` / `index.html` 清理尚未执行，旧通过证据仍可见。
  - Fix: 先使旧证据失效再加载可失败依赖。新增隔离临时目录的缺构建模块、缺 Pillow 启动失败回归，以及 PDF 哈希变化后旧报告失效回归。未触碰当前机器的依赖或字体文件来制造故障。
- File: `scripts/print-acceptance/generate.mjs`
  - Issue: Canvas/PDF 对照已检查 PDF GID 与 Canvas 原点/字号，但没有直接断言 Canvas 请求的字体/GID；样张也缺少对原始输入完整覆盖的独立断言。
  - Fix: 记录真实 Canvas renderer 请求的字体/GID，并与布局逐项比较；将所有槽位的源范围重新投影到原始合成输入，检查非换行文字无遗漏/重复，覆盖跨页末尾“完成”与“wán”。未改样张或生产排版。
- File: `scripts/print-acceptance/generate.mjs`
  - Issue: 直接复制到 `dist/print-acceptance/OWNER-CHECKLIST.md` 的源文档相对链接会指向不存在的文件，不能访问纸张标准和最终清单。
  - Fix: 生成时按输出目录重定位相对文档链接，复验所有本地目标存在。
- File: T10 `evidence.md`, `docs/PRINT_ACCEPTANCE.md`
  - Issue: 证据误称“最大生产样张”，且失败回归计数与新检查不一致。
  - Fix: 更正为“最大候选样张”，更新为本轮 7 项回归和具体检查边界。

## Findings (not fixed)

- 实体 A4/100% 打印、设备/驱动/纸张/可打印区域、公差、字体用途许可及教学字形适用性没有真实验收证据，按 D-044 保留到 T24 / [FINAL_ACCEPTANCE](../../../../../docs/FINAL_ACCEPTANCE.md)。不修改候选 stage，不将 T10-AC2/AC3 标为通过。
- Canvas 为实际 renderer 的调用记录而非实际屏幕像素；字形区域检查不执行 OCR，重叠区域的字形识读与描红教学适用性仍须人工检查。此限制在工具和文档中明确。

## Verification

- Lint: 无项目独立 lint 命令；`node --check`、Python AST 语法与 `git diff --check` 通过。
- TypeCheck: 重新执行 PDF/Canvas 构建通过，含各包 TypeScript 检查。此次新增工具为 JavaScript/Python，没有修改核心类型或运行实现。
- Tests: `python3 -m unittest discover -s scripts/print-acceptance -p 'test_*.py'` **7/7**。
- Generation: 两次独立执行 `node scripts/print-acceptance/generate.mjs`，各 **16 份 PDF / 20 页 A4**；**6,950 段格线 / 1,445 个字形**两档 Canvas 调用与 PDF 操作一致，原始文字完整覆盖。16 原始 PDF、12 诊断 PDF、16 布局摘要两轮完全一致，且与修复前一致。
- Raster: `python3 scripts/print-acceptance/measure.py` 通过 **20 页 / 166 条主线 / 1,251 字形墨迹区域**；Poppler 26.10.0、Pillow 11.3.0。最大中心线误差 **0.014834 mm**、页面外边 **0.019667 mm**、隔离字形外边 **0.068000 mm**，均在已明示的数字容差内。
- Independence: 主线绝对坐标取 PAPER_PRESETS 的测试期望；Poppler 实际像素独立于 Fontkit/Canvas/PDF renderer。完整墨迹外边与共享布局/Canvas 提供的预期比较，不将预期公式本身当作测量结果。600 DPI 的 2 px 边缘及 1.5 px 中心线容差只覆盖数字光栅，不决定实体公差。
- Content: 原始字体 pins、A4、完整嵌入、D-031 字体分配、同文填字/描红逻辑一致、三项不支持输入明确拒绝均由本轮生成检查通过；已独立浏览四模板 filled/tracing 光栅拼图和拼音局部。最大候选 PDF **18,415,385 B**，不据此推定真实服务/手机资源验收通过。
- Delivery: 生成 Owner 表、本轮文档与任务报告的本地链接检查通过；未提交、归档或执行正式预设发布。
