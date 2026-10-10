# 共享运行时验证

T01 开发入口，使用公开合成文本和固定测试字宽，不供正式预览或生成调用。权威规则见 [ARCHITECTURE](../../docs/ARCHITECTURE.md)、[TESTING](../../docs/TESTING.md)。

## 运行

在仓库根目录执行：

```sh
npm install
npm test
npm run smoke
```

根 `npm test` 包含严格 TypeScript 检查、paper-core 自身回归、两个打包目标及原生宿主的 VM 测试。`npm run smoke` 打印不含正文的能力和检查汇总，报告明确标为本地 Node 执行。

`npm run build` 生成：

| 产物 | 用途 |
|---|---|
| `dist/runtime/miniapp/paper-core.cjs` | 同源核心 ES2017/CommonJS 产物，无 Node 依赖 |
| `dist/runtime/cloud/paper-core.cjs` | 同源核心 Node 20/CommonJS 语法目标，不代表 CloudBase 实测 |
| `dist/runtime/{miniapp,cloud}/runtime-smoke.cjs` | 同一合成输入及能力报告入口 |
| `dist/miniprogram/` | 可供微信开发者工具导入的开发诊断宿主 |

微信开发者工具打开仓库根目录，`project.config.json` 指向已生成的 `dist/miniprogram`。当前 `touristappid` 仅作本地宿主；正式 AppID、目标基础库及云服务配置列入 [最终验收](../../docs/FINAL_ACCEPTANCE.md)。修改源码后重新 build，不修改生成目录。开发者工具本地 `project.private.config.json` 不入库。

## 下游接口

- T08/T18 从 `packages/paper-core/src/index.ts` 导入同源核心；esbuild 将其打包到小程序代码中，不下载或动态执行 JS。
- T18 可替换 `miniprogram/app.json` 的首屏，`pages/runtime/index` 保持开发诊断职责，不是 P01～P08 页面。
- T11 可消费云侧核心构建，但部署、SDK、事务与可靠执行由云端任务负责；根构建只清理自己拥有的 `dist/runtime` 与 `dist/miniprogram`。
- `probeRuntimeCapabilities()` 报告 Intl.Segmenter、Unicode 属性正则、Array.at。T03 将分词固定为 `unicode-segmenter@0.17.3`，Intl 与 Array.at 已不属于核心依赖；旧布局路径缺 Unicode 属性正则时明确跳过文字检查。新文档解析器不依赖系统 Unicode 属性实现。
- `runRuntimeSmoke()` 返回固定错误码、检查 ID、页数/线段数和能力布尔值，不返回用户正文或布局。
- `runTextFixture(id)` 只供合成回归，返回完整布局以比较两端数据。其模拟字宽不得作为正式字体度量。

## 覆盖矩阵

| 输入 | 主要断言 |
|---|---|
| 四模板空白格线 | 所有固定线段/位置双端完全一致，既有几何测试锁定中心线数值 |
| 合成标题与 CRLF/LF/空行 | 居中标题、正文缩进及第 2/3/5 行位置 |
| 组合重音、家庭 emoji、扩展汉字 | grapheme 完整，不丢失或拆开 |
| 532 个合成汉字 | 两页、全量文字保留、每页完整格线 |
| 末格汉字和点号 | 点号共用末格，后文续行 |
| 田字格填字/米字格描红 | 相同逻辑占位和分页 |
| 纯空白输入 | 一张完整空白纸 |
| 缺 Array.at | 文字与末格标点仍可运行 |
| 缺 Intl 或 Segmenter / 错误 Segmenter | 固定打包分词库保持文字与两端布局一致 |
| 不支持 Unicode 属性正则 | 模块可载入、检查先阻止文字执行 |

VM 禁止字符串动态编译与 WebAssembly，且不注入 wx、Node require、Buffer 或网络。Node VM 与微信开发者工具模拟器各自不等于 iOS/Android 真机；目标运行时、正式字体、渲染与实体打印仍按最终验收清单取证。
