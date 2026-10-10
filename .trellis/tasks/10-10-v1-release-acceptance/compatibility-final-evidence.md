# T24 兼容与更新流程最终自动化复核

## 范围与结论

在最终源码基线 `77b5e97` 上，针对 `npm run test:compatibility:devtools` 的完整草稿比较失败进行复现与修复。问题位于自动化脚本的输入同步：初始空白纸预览已经处于 `ready`，测试据此提前抓取基线，此时原生输入事件尚未到达 App。没有观察到产品兼容流程丢失或改写草稿；无需修改 App、编辑器或生成业务源码。

原始失败：`/tmp/learn-v1-final-compatibility.log`。定向复现：`/tmp/learn-t24-compatibility-repro.log`。

## 复现证据

临时诊断仅比较字段是否一致和文本长度、换行数量，不输出正文：

| 比较项 | 抓取基线时 | 网络重试后 |
| --- | --- | --- |
| 标题长度 | 0 | 6 |
| 正文长度 | 0 | 11 |
| 正文 CR 数量 | 0 | 1 |
| 正文 LF 数量 | 0 | 1 |

`templateId`、`tracing`、`options` 一致，标题与正文不一致。输入事件进入 App 时已经包含完整的 11 字符正文及 CRLF，以及 6 字符标题。基线为空、后续输入完整，说明等待条件命中了初始预览。临时输入追踪代码已移除。

## 修复

`scripts/test-compatibility-devtools.mjs` 在实际原生输入操作后，等待以下状态同时成立，才抓取完整草稿基线：

- App 草稿标题与正文精确等于测试输入。
- 编辑器状态为 `ready`，预览存在且预览 revision 等于编辑器 revision。
- 预览输入及原生页面数据的标题与正文精确等于测试输入，页面预览状态为 `ready`。

网络重试、显式刷新资源、取消更新三个检查点继续严格比较完整序列化草稿，没有忽略字段或规范化 CRLF，也没有用固定延时替代同步条件。

统一比较助手仅输出字段相等布尔值及标题、正文长度。最终审阅额外将 `assert.equal(after, before)` 改为 `assert.ok(after === before, ...)`，保持相同的完整字符串比较，同时避免 Node AssertionError 自动打印草稿内容。故障注入确认正文变化及新增字段都会失败，而诊断和异常均不包含输入文本。

## 验证

官方自动化环境：`platform=devtools`、基础库 `3.17.3`、模拟微信 `8.0.5`。

1. `npm run test:compatibility:devtools`：重新构建后 7 组通过，应用异常 0。日志：`/tmp/learn-t24-compatibility-final.log`。
2. `node scripts/test-compatibility-devtools.mjs --diagnostics`：相同构建再次运行，7 组通过，应用异常 0。日志：`/tmp/learn-t24-compatibility-repeat.log`。
3. `./node_modules/.bin/tsc -p tsconfig.json`：通过；首轮日志 `/tmp/learn-t24-compatibility-typecheck.log`，最后断言错误脱敏调整后再次通过。
4. `node --check scripts/test-compatibility-devtools.mjs`：通过。
5. 对实际比较助手进行内存故障注入：一致草稿通过、正文变化失败、新增字段失败，且错误与诊断无文本泄露；通过。该检查在两轮 DevTools 验证后的断言错误脱敏调整上执行。
6. `git diff --check -- scripts/test-compatibility-devtools.mjs .trellis/tasks/10-10-v1-release-acceptance/compatibility-final-evidence.md`：通过。

仓库没有独立 lint 命令；本次完成脚本语法检查与差异空白检查，不将它们描述为 ESLint 检查。

最终报告：`dist/compatibility-evidence/report.json`。七组覆盖：

- 单一 App 客户端、启动/前台共享查询与更新监听注册。
- 原生网络重试及完整草稿保留。
- 实际本地服务的旧版本锁定、退役、显式资源刷新与重新预览。
- 代码更新失败与资源失败区分，历史仍可查看。
- 原生更新按钮及模拟取消回调保留草稿。
- 更新就绪与模拟确认回调仅调用一次模拟重启。
- 实际原生更新警告及产品按钮选项渲染。

已查看 `native-update-input-warning.png` 和 `cleanup-home.png`：警告明确重启不会保留当前正文、应先复制保存；清理后回到首页，无残留弹窗或诊断草稿界面。预期的未配置服务提示不作为故障。

## 模拟边界与清理

原生页面、输入、按钮、警告渲染和实际本地 CloudService 执行真实路径；兼容请求使用内存桥接，UpdateManager 事件、`applyUpdate` 及确认/取消回调使用模拟。官方正式发布更新、真机原生弹窗交互、真实 CloudBase 配置、正式字体和实体打印仍交由 Owner 最终验收，不因这两轮自动化而标记通过。

每轮结束均恢复原生更新及弹窗 API、清除诊断状态与用户数据、重新进入首页关闭残留弹窗，再断开自动化连接；未关闭开发者工具。开发者工具与本脚本的独占使用已结束。

既有 Fontkit 重复 `axisIndex` 构建警告与本次输入同步问题无关，未修改依赖源码。
