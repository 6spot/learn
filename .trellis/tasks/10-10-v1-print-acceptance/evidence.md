# T10 本地交付证据

日期：2026-10-11。按 D-044 完成本地阶段 A；最终阶段 B 的实体打印、真机与用途许可仍未通过，统一移交 T24/Owner。无生产核心或字体/渲染算法修改，全部预设保持 `development-candidate`。

## 实际执行

- `task.py start .trellis/tasks/10-10-v1-print-acceptance` 成功，分配分支 `feat/learn-v1`。
- `npm --prefix packages/pdf-renderer run build`、`npm --prefix packages/canvas-renderer run build` 成功。PDF 共享构建 563,366 B。
- `node scripts/print-acceptance/generate.mjs`：四模板 × blank/filled/tracing/multipage = **16 PDF / 20 A4 页**；原始字体分配符合 D-031，`pdfinfo`/`pdffonts` 验证 A4 和完整嵌入。
- 两档 Canvas 调用与真实 PDF 解压操作对照 **6,950 段格线、1,445 个字形 GID/原点/字号**，布局摘要不变；独立检查补验 Canvas 实际请求的字体/GID 和全部原始合成文字的槽位覆盖。所有同文填字/描红的逻辑行与槽位相同。这里不声称实际 Canvas 像素通过。
- 重复生成后 **16 原始 PDF、12 去格线诊断 PDF 的 SHA-256 和 16 布局摘要完全一致**；安全计数记录在忽略的 `reproducibility.json`。
- `python3 -m unittest discover -s scripts/print-acceptance -p 'test_*.py'`：独立检查后 **7/7 通过**。失败回归拒绝裁切/偏移外边、格线消失/偏移、缺失/额外字形墨迹；保留浅灰描红像素与正确毫米换算；新增缺少构建模块/Pillow、PDF 哈希变化后旧报告失效的隔离回归。
- `python3 scripts/print-acceptance/measure.py`：**20 页、166 条主格线、1,251 个有墨迹字形区域通过**。
- `node --check scripts/print-acceptance/generate.mjs` 与改动差异空白检查通过；本轮未改纸张核心，不用重复核心历史测试冒充新验收。
- 已浏览四模板 filled/tracing 的光栅拼图与拼音局部；完整外框、调号、上下伸部与描红字形可见。浏览不替代规范字形或打印认定。

## 数字测量

Poppler 26.10.0、Pillow 11.3.0，600 DPI；像素 0.042333 mm，灰度 < 250 计为墨迹，抗锯齿开启，细线增强关闭。像素单元外边测完整墨迹；横截面墨量重心测主格线中心。数字容差分别为 2 px / 1.5 px，不能套作实体公差。

| 指标 | 实际最大误差 | 数字容差 |
|---|---:|---:|
| 中心线 | 0.014834 mm | 0.0635 mm |
| 完整页面墨迹外边 | 0.019667 mm | 0.084667 mm |
| 去格线后字形墨迹外边 | 0.068000 mm | 0.084667 mm |

诊断副本从同一 PDF 仅把独立格线 `S` 改成 `n`，保留完整字体、文本矩阵与 GID，不重新布局。每个字形预期墨迹区域有像素，区域容差并集之外无额外墨迹；重叠字形仍需人工识读，不是 OCR。

三项合成拒绝样例分别为缺字、拼音格输入汉字、重复调号，按预期返回 `MISSING_GLYPH` / `UNSUPPORTED_TEXT` / `UNSUPPORTED_TEXT`，不生成截断文件。全套内容均显式合成，未使用历史用户作文。

## 产物与上限

- 可再生的 PDF/PNG/HTML、版本/字体 pins/文件哈希 manifest、`measurements.json`、`OWNER-CHECKLIST.md` 位于忽略的 `dist/print-acceptance/`。
- 最大候选样张 `mi-grid-tracing.pdf` 为 **18,415,385 B**；完整 MiSans 和霞鹜文楷混合嵌入，最终资源/真机能力另验。
- engine `learn-engine-dev.4`；方格预设 `v1-development.1`，拼音 `v1-development.2`；font bundle `learn-fonts-2026-10-10-candidate.1`。
- 工具新一轮启动后、加载字体/构建依赖或 Pillow 之前删除旧通过报告和索引；量测仅在全部完成后写新的通过报告，避免依赖加载失败后残留旧通过状态。Owner 表的文档链接按输出目录重定位。

## 最终移交

详细表和命令见 [PRINT_ACCEPTANCE](../../../docs/PRINT_ACCEPTANCE.md)。Owner 最后填写打印机/驱动/纸张/100%设置、中心线和墨迹实测、可打印区域/公差、字形/灰度/多页、真机 Canvas/PDF 对照与用途许可。通过前不修改 stage，不使用本数字报告独立发布正式 active，不宣称霞鹜文楷为官方规范教学字体。

本轮独立检查及复验见 [check](check.md)；等待主会话全局文档合并及提交/归档。reviewer 未提交或归档；T10-AC2/AC3 不因本地检查而标为通过。
