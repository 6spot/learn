# T20.A 生成会话验证记录

2026-10-11。本记录仅覆盖 [设计](design.md) 的 portable 会话与安全随机适配；App、页面、T21 路由及真实微信/CloudBase 验收由后续集成补充。没有把 T20 整项标记完成。

## 变更

- `miniprogram/lib/secure-random.ts`：按官方 wx.getRandomValues 回调契约取得 16 字节，复制后设置 UUID v4 位；拒绝缺失/错误长度/错误类型/失败，不用时间、设备 ID 或 Math.random 降级。
- `miniprogram/lib/generation-session.ts`：真实预览完成前验证 revision，之后冻结同次生成输入/选项/版本/digest；共享完整请求号与参数，未知结果查询原请求，同号重试，明确 startNew 才换号。
- view 不暴露原文、布局、摘要或请求号；只有合法且匹配的任务结果触发 `onJobKnown(jobId)`。RESERVED/pending 只说明找到记录，不声明可靠交接已完成或已开始执行。
- 本地等待超时不改云端任务/额度。晚到提交与查询均可恢复 known；clear 增加 epoch、释放自有快照并阻止旧回调发送/回写/导航，不声称取消云端任务。
- 新增两份测试；设计与执行清单同步本阶段边界。

## 本轮实际执行

| 命令 | 结果 |
|---|---|
| `node --test miniprogram/test/secure-random.test.mjs miniprogram/test/generation-session.test.mjs` | **24/24**（安全随机 3、生成会话 21） |
| `./node_modules/.bin/tsc -p tsconfig.json` | 通过 |

测试以 esbuild `platform: neutral / target: es2017 / write: false` 在内存构建模块，不修改共享开发产物、不重启 DevTools。所用 core/font-metrics/cloud-service 构建产物及本地原始字体已由当前开发环境提供；本次没有宣称从干净 checkout 重建全仓库。

覆盖：双击共享 Promise、完整请求冻结、异步预览前输入变更、捕获后 random/window 等待期间编辑、签窗失败保留旧预览、明确额度拒绝后同号重试、未知响应查原号、查不到后显式同号重发、查询故障不另发、请求过期不续窗、已知操作重用与明确新生成、兼容门槛不阻止旧请求恢复、导航失败保留记录。另覆盖提交/查询晚到、等待与清理、同步监听器清理、随机源不可用、准备超时后的迟到拒绝、坏响应及 pending/settled 配对。

新增超时测试初次执行有 1 项测试装置错误：共享 deferred helper 只有 resolve，没有 reject；已改为通过 resolve 采纳 rejected Promise，随后 24 项全通过。没有把首次失败结果当作通过记录。

## 实际服务代码路径

测试使用实际 `GenerationSession → CloudClient → CloudService`，服务在成功结算后模拟响应丢失。调用次序为 `getSubmissionWindow → submitGeneration → findJobByRequest`；一次渲染、一个原任务、额度 20→19。再次 retry 只返回已有 job；明确 startNew 后才第二次渲染，额度 19→18。

真实文本预览使用实际 EditorSession、MiSans 字体度量和布局摘要。上述服务故障用例复用 cloud-service 的执行测试装置及标明合成的 PDF 产物，**不等于真实 PDF/云存储/执行交接验收**；这些能力已有各自任务证据，本用例只验证本次会话的调用、去重与扣次行为。

## 集成接口与剩余验收

App 创建 `GenerationSession({client,editor,canGenerate,secureUuid,onJobKnown,waitTimeoutMs,timers?})`；安全随机注入 `() => secureUuidV4(wx)`；兼容门槛来自共享 `compatibility.view.canGenerate`；`registerUserDataCleanup(() => generation.clear())` 连接隐私清理。waitTimeoutMs 是 UI 等待阈值，不可据此宣称云端执行期限。

`submit()`/`retry()` 可复用已知操作；页面必须在用户明确再次生成时调用 `startNew()`。未知结果时 startNew 会查询原请求，禁止静默换号。页面需要显示当前操作/重试语义，不能把 retained 旧快照当作新输入提交。会话仅在内存持有输入；重启后通过 T21 查询云端记录，不承诺恢复草稿。

`onJobKnown(jobId)` 由集成层导航至唯一 `/pages/records/detail?jobId=...`。会话不创建第二套详情或云任务状态机。当前未验证该实际路由、原生按钮、后台/重进路径、官方随机 API 调用或 App 清理集成；独立检查和原生模拟器由 root 继续。组件/CloudBase 配置、iOS/Android 真机、正式微信更新、字体许可与实体打印仍留 T24/Owner 最终验收。

## 阶段 A 独立检查

[session-check.md](session-check.md) 记录本次独立检查。安全随机适配修复了伪装 ArrayBuffer 被当作零字节来源、API getter 异常越过安全边界两处问题；均先建立失败回归再修复。会话产品源码无需修改。

修复后两个模块测试 **25/25**（随机 4、会话 21），模块及其依赖使用根严格 TypeScript 选项检查通过，MJS 语法/范围差异通过。root 全项目 tsc 初次通过；最后一次因并行新增 T21 records 页面尚缺 App.records 契约及相关 view 类型而报 6 项错误，已交主会话协调。没有用修改他人文件或关闭严格检查绕过。

本次仍只验证阶段 A；未运行共享构建或 DevTools，App/页面注册和最终原生端到端还须阶段 B 验证。
