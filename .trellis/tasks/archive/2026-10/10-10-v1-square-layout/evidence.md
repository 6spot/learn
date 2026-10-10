# T05 方格布局验证

完成时间：2026-10-11。开发实现与原字体数学检查已完成；真机和实体打印按 D-044 留到最终验收。

## 实际运行

| 命令 | 结果 |
|---|---|
| `cd packages/paper-core && npm run baseline:square` | 生成 4 份公开合成基准：选项/源映射、末格点号、田字描红、米字括号；坐标断言和完整基准比较通过 |
| `cd packages/paper-core && npm test` | 独立复核最新结果：TypeScript 编译 + **56/56**；既有41项、T05原有12项及独立补充3项 |
| `cd packages/paper-core && npm run test:integration` | 重建 T04 原字体 provider，**7/7** 通过；三模板普通/描红、全角/重音/长词、真实字宽和七种末格点号 |
| 实现阶段根目录 `npm test` | 当时严格类型检查 + core53 + runtime13 + cloud25，**91项通过**；独立复核只补测试，未重复并行开发中的根集成构建 |
| `git diff --check` | 通过 |

字体构建显示 fontkit 原依赖的 `axisIndex` 重复 key 警告；构建成功。未修改或复制字体资源；实际使用 `assets/fonts/manifest.json` 中已校验的官方原字体与 T04 provider。

## 已验证行为

- `layoutSquarePaperDocument` 三种方格共用一个布局实现，返回正式 PaperLayout。几何不变；共享 engine 版本以 `development-presets.ts` 为准，由后续 T06/T07 统一推进。
- 标题逐视觉行 left/center/right，正文按可信默认或 none 缩进；换行不再次缩进，显式首尾空段完整分配，包括第3页仅一条空行的样例。恰好满页无额外空页；只含空白仍为一张空白纸。
- canonical 字体给拉丁/数字/空格真实 advance 和 ink overhang；普通单词/小数保持整体，超过整行的单词按完整 grapheme 续行并重新 shape；全角字母/数字和弯引号缩写不作兼容归一化。
- D-025 七种点号都在三模板普通/描红原字体下验证独立缩小右下格位，前汉字坐标不动，后文正常续行。
- D-047 普通成对引号/括号、双省略号/破折号保持源字符；末格 Han+点号后无法容纳第二点号或闭符号时明确 UNSUPPORTED_TEXT。
- 描红与填字逐页 lines/slots 完全相同；作文沿用 MiSans，田/米只有 Han glyph 改为霞鹜文楷 GB，拉丁不换字体。每个实际 glyph 的完整 ink 在分配 slot 和固定几何区域内。
- 真实测试覆盖 `é`、`nǚ`、`Ǹ`，验证原 UTF-16 映射及 glyphOutline 可获取；缺字 emoji、禁止的 ZWJ、字体版本不符、非法度量、超大字形/页数均明确拒绝，原文不被替换或丢弃。
- 所有完整布局与错误均不写日志；缓存只在单次布局内部，调用结束即释放。

## 独立复核（2026-10-11）

未发现需修复的方格算法问题。新增三类回归：三模板跨页长标题逐行对齐、CRLF 空段和标题/正文间距；3,003 字符长小数跨页完整保留且续行不再次缩进；负左侧边距与下降字形在不同 Latin run 中共用基线、完整墨迹不裁切。核心 56/56、原字体集成 7/7 通过。

四份合成布局基准重新生成后 SHA-256 完全一致；不是只把新输出覆盖成期望值。原字体测试与独立坐标断言共同支持布局结果，仍不替代实际渲染和打印。完整复核范围与剩余边界见 [独立复核报告](independent-check.md)。

## 接口和后续

API 与命令说明见 [paper-core README](../../../../../packages/paper-core/README.md)。根 package manifest 增加标准 main/types/exports，供云端包直接消费；核心依旧只依赖纯 JS 分词库，原字体/文件系统只出现在 integration 测试中。

T06 继续实现独立拼音行带算法；T07 对新 PaperLayout 做版本和摘要。旧 layoutSquareDocument 保留给 T01 历史回归，不是正式渲染入口。Canvas/PDF 尚未由本任务验证，完整字形目视/真机/物理打印留至 [最终验收](../../../../../docs/FINAL_ACCEPTANCE.md)。主会话负责独立检查、提交和归档。
