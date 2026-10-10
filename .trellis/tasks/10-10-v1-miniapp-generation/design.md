# T20.A 生成会话设计（2026-10-11）

root 已确认本阶段只新增 portable `generation-session.ts`、`secure-random.ts` 与测试；App/编辑/预览页面、T21 详情、root 传输及主文档另由协调集成。行为缺口是从当前真实预览生成一次不可变的内存请求，并安全处理双击、响应丢失与清空。

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

隔离编译/测试两个新模块，不占用共享 DevTools 或改 App/build。验证安全随机API不可用/坏返回/版本位/跨realm ArrayBuffer；双击、编辑在prepare/random/window等待期间变化、同号重试、未知响应先查、pending不假称开始、超时晚到、clear期间/之后结果、坏响应/导航失败和明确再次生成。至少一条实际 CloudClient + CloudService 路径核对一次消费；T19/T21页面与真实设备/CloudBase由后续整项验收。
