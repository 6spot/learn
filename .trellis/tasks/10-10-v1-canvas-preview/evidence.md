# T08 本次验证证据

日期：2026-10-11。状态：Canvas 代码和模拟器流程完成，独立检查及修复后回归通过；不代表生产字体分发、真机或打印验收。

## 实现

- `packages/canvas-renderer`：仅绘制排版提供的当前页；统一 mm→CSS px→backing pixels；逐段线型、完整墨迹与真实字形轮廓预检，字形 baseline/offset 只施加一次。无 `measureText`/`fillText` 或分页逻辑。
- `miniprogram/components/paper-canvas`：原生 2D Canvas；布局/字体不上 setData；连续请求取消旧回调，detach 即使收不到 setData 回调也解除等待并清空 bitmap；失败隐藏旧画面。
- `miniprogram/lib/font-loader`：指定字体集合、原文件 SHA 校验、私有缓存、在途请求复用、损坏缓存删除及重试、可信 HTTPS 配置；不请求未配置的网络地址。
- `scripts/build.mjs`：依赖从源生成，font-metrics 单份 ES2017 vendor，各 native entry 用正确相对 require；保留原 runtime 诊断页及双目标 smoke。
- 开发诊断页与官方 automator 只用固定样例，未建立 P01-P08 产品导航。

## 本次检查

| 命令/检查 | 实际结果 |
|---|---|
| `npm run build` | 通过；完整生成原生宿主和双目标 runtime |
| `npm run typecheck` | 通过 |
| `npm --prefix packages/canvas-renderer test` | 独立修复后 **15/15** 通过：原13项及完整Canvas API预检、可选缓存写入失败回归 |
| 实现阶段 `npm test` | 当时根回归107/107通过：core69、runtime13、cloud-runtime25；不是后续并行修改后的全量结果 |
| 独立修复后 `npm run test:runtime` | 重建原生宿主和双目标共享bundle，**13/13**通过 |
| `node scripts/test-canvas-devtools.mjs --diagnostics` | 官方 DevTools，base library 3.17.3，模拟微信 8.0.5；11 个样例流程通过，翻页/缩放/错误恢复通过，app exceptions=0 |
| 人工查看模拟器截图 | MiSans 方格填字、LXGW 汉字描红及 MiSans Latin 大小写调号/组合字符预览可见，字形无系统字体替换 |
| `node scripts/setup.mjs --list` / 脚本语法检查 | 列出根目录及5个独立包；setup/build/automator脚本语法与作用域差异检查通过。未在共享目录执行npm ci |

模拟器私有目录实际写入三份完整原字体，合计 34,159,620 字节；候选 bundle 为 `learn-fonts-2026-10-10-candidate.1`。截图和机器报告位于忽略的 `dist/canvas-evidence/`，可由同一脚本重建。截图不是手机/实体打印证据。

| 固定样例 | 页数 | 当前页线段 | 当前页 glyph |
|---|---:|---:|---:|
| 作文空白 | 1 | 48 | 0 |
| 田字空白 | 1 | 439 | 0 |
| 米字空白 | 1 | 847 | 0 |
| 拼音空白 | 1 | 56 | 0 |
| 田字填字/描红 | 各 1 | 各 439 | 各 20 |
| 拼音填字/描红 | 各 1 | 各 56 | 各 56 |
| 米字多页 | 3 | 847 | 首页面 210 |

初始显示宽 358 CSS px、DPR 3、bitmap 宽 1074；在第二页切换 1.5 倍视图后，glyph 数与毫米墨迹边界严格相同，只有画布尺寸改变。资源缺失明确进入 error，report 清空，再运行填字恢复成功。

## 调试中发现并解决

- DevTools 连续 `appendFileSync` 增长原字体时，在约 7 MB 处报告存储限制。改为 automator 分块传到诊断内存后单次 `writeFileSync`，三份原文件均成功写入；未修改配额、字体字节或平台设置。文件写入与实际字节校验继续使用原生 API。
- 官方 automator 的 `page.data('report')` 将 null 叶子返回为 undefined；断言改为读取完整 data 对象中的 report，确认渲染失败实际已清空，不把 SDK getter 差异当业务错误。
- 构建可见 fontkit 已有 axisIndex 重复键 warning，来源是上游字体库；本轮未修改依赖，T04 检查与本任务原始静态 TTF 用例通过。

## 独立复核修复

- 原先只预检两项 Canvas API；缺少 `quadraticCurveTo` 时，实际会先画白底和48条作文格线，再抛原始 TypeError。现已在修改bitmap和绘制前校验全部所需API，返回 `CANVAS_UNSUPPORTED_API`；回归逐项移除15种方法，确认零绘制且旧bitmap尺寸不变。
- 原字体已校验成功后，可选缓存 `writeFile` 同步抛错会导致整个加载失败。现与异步fail回调一致，保留已校验的内存provider并正常复用；不因可选持久化不可用而拒绝预览。
- 修复后重新运行本表的typecheck、Canvas测试、runtime构建测试和官方11case模拟器流程，零应用异常。详细范围和局限见 [独立复核报告](independent-check.md)。

## T07开发代码集成

T06/T07联合独立复核期间，将Canvas实际字体样例切换到 `layoutPaperDocument`，并新增四模板空白/填字/描红、多页、不同DPR/zoom下 `createLayoutDigest` 绘制前后完全一致的检查。最新Canvas测试 **16/16**通过，T07统一入口与摘要的代码依赖已收齐；未修改renderer算法，也未因新增测试无目的重跑DevTools。正式资源发布、PDF对照及设备打印仍保持最终验收状态。

## 最终交接项

按用户授权，这些均后置，不阻断继续开发：授权字体资源托管/合法域名/真实 AppID 配置；iOS/Android 原字体读取、Canvas 能力及内存/首屏/翻页性能；T07 受支持发布版本组合与 T09 PDF 的相同布局对照；物理墨迹与 A4 实体打印。现用开发候选字号/线型，不将模拟器可见写成正式打印规格已通过。
