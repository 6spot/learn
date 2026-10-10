# T20 生成会话与原生集成验证记录

2026-10-11。本记录覆盖 [设计](design.md) 的 portable 会话、安全随机适配及阶段 B App/编辑/预览集成。初次原生页面测试在 VM 运行 emitted 构建；阶段 B 独立检查改用当前源码内存构建以避免共享产物过期。官方模拟器由 baseline 统一操作，真实微信/CloudBase 留最终验收，没有提前标记整项完成。

## 变更

- `miniprogram/lib/secure-random.ts`：按官方 wx.getRandomValues 回调契约取得 16 字节，复制后设置 UUID v4 位；拒绝缺失/错误长度/错误类型/失败，不用时间、设备 ID 或 Math.random 降级。
- `miniprogram/lib/generation-session.ts`：真实预览完成前验证 revision，之后冻结同次生成输入/选项/版本/digest；共享完整请求号与参数，未知结果查询原请求，同号重试，明确 startNew 才换号。
- view 不暴露原文、布局、摘要或请求号；只有合法且匹配的任务结果触发 `onJobKnown(jobId)`。RESERVED/pending 只说明找到记录，不声明可靠交接已完成或已开始执行。
- 本地等待超时不改云端任务/额度。晚到提交与查询均可恢复 known；clear 增加 epoch、释放自有快照并阻止旧回调发送/回写/导航，不声称取消云端任务。
- 新增两份测试；设计与执行清单同步本阶段边界。

## 阶段 A 实际执行

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

App 创建 `GenerationSession({client,editor,canGenerate,secureUuid,onJobKnown,waitTimeoutMs,timers?})`；安全随机注入 `() => secureUuidV4(wx)`；兼容门槛来自共享 `compatibility.view.canGenerate`；集中 `clearUserData` 首先直接调用 `generation.clear()`，再尝试其他所有者。waitTimeoutMs 是 UI 等待阈值，不可据此宣称云端执行期限。

`submit()`/`retry()` 可复用已知操作；页面必须在用户明确再次生成时调用 `startNew()`。未知结果时 startNew 会查询原请求，禁止静默换号。页面需要显示当前操作/重试语义，不能把 retained 旧快照当作新输入提交。会话仅在内存持有输入；重启后通过 T21 查询云端记录，不承诺恢复草稿。

`onJobKnown(jobId)` 由集成层导航至唯一 `/pages/records/detail?jobId=...`，需要 App 前台、有效编辑/预览可见 token 及匹配的顶层路由；离页或后台时保留 known 并提示从记录查看，回前台不补跳。会话不创建第二套详情或云任务状态机。下面记录阶段 B 实际实现与本地验证。

## 阶段 B 变更与验证

`editor-environment.ts` 创建唯一 GenerationSession，沿用 App 的 client/editor/compatibility，接 wx 安全随机与 navigateTo。集中 clearUserData 首先 generation.clear，继续所有原有清理责任；T21 的 App/records 类型由其所有者接入。

编辑和预览 TS/WXML 消费共享 `generationPageState`，字段仅为安全文本、状态和布尔值。主按钮 `#generate-pdf` 等待当前 revision 的 Canvas display 成功，busy/未知结果禁用；known 后明确“再次生成 PDF”并 startNew。`#generation-query` 只查原号，`#generation-retry` 沿用上次快照；改文显示“内容已修改；查询或重试仍对应上次提交的内容”。离页停止自身订阅/绘制，不清空生成会话或取消云端工作。

| 本次命令 | 结果 |
|---|---|
| `npm run typecheck && npm run build` | 通过；保留已知 fontkit 构建产物 axisIndex 重复键警告，没有新增编译错误 |
| `node --test miniprogram/test/generation-native.test.mjs miniprogram/test/generation-session.test.mjs miniprogram/test/secure-random.test.mjs` | **32/32**：原生集成 7、会话 21、安全随机 4 |
| `node --test miniprogram/test/compatibility*.test.mjs miniprogram/test/editor*.test.mjs miniprogram/test/privacy.test.mjs packages/runtime-smoke/test/runtime.test.mjs` | **61/61** |
| `npm run test:canvas` | **22/22** |
| `git diff --check` | 通过 |

原生集成测试运行实际构建的 App、两个 Page、GenerationSession、CloudClient 和 CloudService，使用真实 MiSans 资源描述/度量，RPC 入参经 JSON 跨 realm 模拟。原生 wx 随机/导航、Canvas 展示、文件系统和网络故障由明确替身控制；执行测试装置仍为标明合成的 PDF，不冒充官方模拟器或真实 CloudBase。

7 项用例验证：两入口共用会话且双击只一次扣费、known 后显式新生成才另扣一次；未知结果跨页阻止新生成且编辑后同号只重试旧输入；成功响应丢失+查询失败后 retry 查回原任务；离页不取消任务也不跳回；App 隐私清理使迟到结果无效；Canvas 尚未完成/失败不能生成；真实按钮具有 loading/disabled 与明确原请求动作。每个适用用例均核对后端渲染次数、额度及请求相等性。

回归首次有 1 项旧 T19 占位断言失败，原因是测试仍要求 `generation.available === false`。已更新为唯一真实会话状态及集中清理先调用 generation.clear 的断言，再运行全部 61 项通过；未改变原有兼容/更新业务规则。独立 checker 对阶段 A 随机品牌校验的修复及 25 项结果见 [session-check.md](session-check.md)，本阶段完整保留。

阶段 B 产品源码已释放给 root 的独立检查者；实现者没有操作 DevTools、提交或归档。官方 wx.getRandomValues、原生界面全链路及实际 T21 文件打开由 baseline 补证；组件/CloudBase 配置、iOS/Android 真机、正式微信更新、字体许可与实体打印仍留 T24/Owner 最终验收。

## 阶段 A 独立检查

[session-check.md](session-check.md) 记录本次独立检查。安全随机适配修复了伪装 ArrayBuffer 被当作零字节来源、API getter 异常越过安全边界两处问题；均先建立失败回归再修复。会话产品源码无需修改。

修复后两个模块测试 **25/25**（随机 4、会话 21），模块及其依赖使用根严格 TypeScript 选项检查通过，MJS 语法/范围差异通过。root 全项目 tsc 初次通过；最后一次因并行新增 T21 records 页面尚缺 App.records 契约及相关 view 类型而报 6 项错误，已交主会话协调。没有用修改他人文件或关闭严格检查绕过。

本次仍只验证阶段 A；未运行共享构建或 DevTools，App/页面注册和最终原生端到端还须阶段 B 验证。

## 阶段 B 独立检查

[final-check.md](final-check.md) 记录本轮发现、修复与范围。原实现只核对顶层路由；新增测试证实 Page hide 保留原路由、App hide 早于 Page hide 两种情况都会在后台跳转。经 root 同意且与 T21 所有者协调，补充 generationNavigation 的前后台、可见页面 token 与路由联合守卫；旧页面清理不影响新 token。known 仍保留，回前台不补跳，不取消或重发云端工作。

原生生成测试改为 esbuild `write: false` 在内存构建当前 App/两页源码，避免 shared dist 未更新造成假通过；字体使用现有原版 miniapp provider 构建产物。新增四项回归：隐藏页仍在栈顶、App 先隐藏、旧页面 token 晚清理，以及旧 Canvas 绘制完成不能放开新输入生成。初次两个生命周期回归失败（各发生一次不应有的导航），修复后全部通过。

| checker 实际命令 | 结果 |
|---|---|
| `node --test miniprogram/test/generation-native.test.mjs` | **11/11** |
| `node --test miniprogram/test/generation-session.test.mjs miniprogram/test/secure-random.test.mjs miniprogram/test/compatibility.test.mjs miniprogram/test/editor-session.test.mjs` | **52/52** |
| `node --test miniprogram/test/privacy.test.mjs packages/canvas-renderer/test/*.test.mjs` | **37/37** |
| `node --test miniprogram/test/compatibility-native.test.mjs miniprogram/test/editor-native.test.mjs packages/runtime-smoke/test/runtime.test.mjs` | **19/19**；baseline 确认统一 build 含本次修改后执行 |
| `./node_modules/.bin/tsc -p tsconfig.json` | 通过 |
| `node --check miniprogram/test/generation-native.test.mjs`、`git diff --check` | 通过；仓库没有独立 lint 脚本 |

本 checker 未运行共享 build 或 DevTools；baseline 确认统一重建包含本次修改后，本 checker 补跑 emitted editor/compatibility/runtime 并通过。全部专项合计 **119/119**；旧 fontkit axisIndex 重复键构建警告未变。官方模拟器由 baseline 继续整合。本轮同步 [generation submission spec](../../spec/frontend/generation-session.md)，没有把真实平台、云配置和打印验收标为通过。
