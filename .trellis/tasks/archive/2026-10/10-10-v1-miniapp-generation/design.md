# T20 生成会话与原生集成设计（2026-10-11）

阶段 A portable 会话与安全随机适配已通过独立检查。root 于 T19 归档后授权阶段 B：本实现者接 editor-environment、application 的 generation 类型、编辑/预览 TS/WXML/必要样式与测试；T21 所有者负责 app.ts、records 类型/页面和路由，DevTools 由 baseline 串行操作。保留并行任务修改，不改后端、纸张布局或新建结果页。

当前缺口是原生生成按钮仍为占位；将其连接到唯一 App.client/editor/compatibility/generation。编辑和预览只有成功绘制当前 revision 后启用当前内容的生成按钮；等待中禁用，known 后下一次明确点击 startNew。错误/未知结果显示上次操作及其查询/重试，不将新编辑混入旧请求。

## 接口

`new GenerationSession({client,editor,canGenerate,secureUuid,onJobKnown,waitTimeoutMs,timers?})`。client 只需 getSubmissionWindow/submitGeneration/findJobByRequest；editor 只需 revision/preparePreview；canGenerate 消费唯一应用兼容结果，不重复检查版本；secureUuid 注入微信安全随机源；onJobKnown 只传 jobId。原生详情路径是 T21 的 `/pages/records/detail?jobId=...`，会话不拼路由。

公开 submit/retry/recover/startNew/clear/subscribe 与不含原文、请求号或布局的 view。submit 同一操作重复调用复用（含已 known 操作）；只有用户明确再次生成才 startNew。尚 uncertain 时禁止悄悄 startNew，先查原号或同号重试。

## 快照与随机

开始时记录 editor.revision，等待真实 preparePreview；完成前 revision 变化则拒绝，不签窗/提交。完成后核对版本与实际 layout digest，复制并冻结 PaperInput、版本与digest。之后编辑发生变化不污染已捕获操作。整个布局、字体对象和原文不进入 page data、路由、storage 或日志。

wx.getRandomValues 按 [官方研究](research/random-source.md) 请求16字节，用版本/variant位生成UUIDv4，再调用共享 createRequestId 组合完整签名窗口号。不用 Math.random、时间或设备ID替代，异常只返回安全错误。未形成完整请求号前的签窗失败可以重试；一旦完整号固定，重试不续窗、不重新随机、不改变参数。

## 等待与已知记录

view status 为 idle/preparing/submitting/querying/uncertain/known/error，只有客户端工作阶段，不复制云端任务状态机。明确的提交前/受理拒绝展示可理解原因；NETWORK_UNAVAILABLE、INVALID_RESPONSE、INTERNAL_ERROR、EXECUTION_OUTCOME_UNKNOWN 等不能当云端失败。响应未知先 findJobByRequest；只有查询明确 null 才可由 retry 同号重发，查询失败不换号。

waitTimeoutMs 是本地单次等待阈值，不是云端deadline；超时没有退款/FAILED推断。真实响应/查询必须匹配原requestId/template与安全jobId，才更新 known 和回调。RESERVED/pending也只表示找到持久记录，文字不写“已开始”或“已完成可靠交接”。晚到可信响应可以恢复 known，重复回调去重。

clear 增加 epoch、取消本地等待并释放自有快照；晚到结果不得回写或导航，不取消已在云端运行的任务。已交给平台调用的请求字节无法从远端撤回，隐私清空不作这种承诺。

## 验证

阶段 A 隔离编译/测试模块已完成。阶段 B 按根 typecheck/build 和实际 emitted 原生页面测试验证接口与按钮，不自行占用 DevTools。验证安全随机API不可用/坏返回/版本位/跨realm ArrayBuffer；双击、编辑在prepare/random/window等待期间变化、同号重试、未知响应先查、pending不假称开始、超时晚到、clear期间/之后结果、坏响应/导航失败和明确再次生成。至少一条实际 CloudClient + CloudService 路径核对一次消费；官方模拟器由 baseline 集成，设备/CloudBase留最终 Owner 验收。

## 阶段 B 原生接口

createEditorEnvironment 注入安全随机与原生 navigateTo，清理时先 generation.clear，再处理共享兼容/编辑/字体及外部清理所有者。generationNavigation 接 App onShow/onHide 与编辑/预览页面的可见 token；仅 App 在前台、可见 token 有效且顶层路由与该 token 一致时自动导航至 P06。旧页面清理只释放自己的 token；App 进入后台立即失效当前 token。用户已离页或切后台时保留 known，可从生成记录查看；回前台不补跳。页面 onHide/onUnload 取消自身订阅、可见 token 与绘制，不取消云端任务或清空生成快照。

两页使用相同安全字段投影，控件 ID 为 generate-pdf、generation-status、generation-query、generation-retry。查询只查原号；重试保留原快照，修改后明确文案说明。新生成是当前内容的新请求；原结果未知时不可启用新生成。只传 jobId 的 navigateTo 保留原生返回来源，不附带原文或完整请求号。
