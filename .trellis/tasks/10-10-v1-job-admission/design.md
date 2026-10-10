# T14 签名请求与原子受理设计

> 2026-10-11。按 D-044 自主实现，生产参数显式配置；真实 CloudBase 交接/资源最终实测由 T24 承接。

## 行为差距与变更边界

现有服务有账户和预设，但没有生成请求、限额、去重或执行接手。修改 cloud-service contracts/config/service，新增 admission/request/job 模块和行为测试。核心版本/文字/物理规则复用 paper-core，云端运行端口复用 T11；不写 Node/微信 API，不修改字体、纸张、前端或根工具。

## 请求号与生命周期

`getSubmissionWindow()` 签发 `{windowId,expiresAt}`。windowId=`w1.keyId.issuedAt36.expiresAt36.serverUuid.signatureHex`，HMAC 绑定可信 userId、时间与随机窗口。客户端以可靠 UUIDv4 调用纯 `createRequestId(windowId,nonce)` 生成完整 `r1.<windowId>.<nonce>`。窗口身份属于请求号，不接受可续期的分离 token 给旧裸 UUID 续命；完整号变更才是新操作。

数据库去重键为 SHA-256(userId,完整 requestId)。每次先鉴权和基础输入校验，再查现有记录：已存在时按原 fingerprint key/canonical version/默认值/输入限制计算并比较，同参返回原任务，异参拒绝，不因窗口过期/active切换/旧资源退出而重排。原记录已清理且原窗口过期时拒绝，绝不创建新消费。清理遵循 D-050，不提前删除仍有效窗口或未终态任务的记录；旧 key 必须保留至引用记录/窗口结束。

## 指纹

固定数组序列化的 `learn-request-v1` 覆盖工具 paper、输出 pdf、可信 userId、完整请求号、title/body 原始字符串、tracing、titleAlign 的可信默认表达、bodyIndent 默认表达、完整 tuple 与客户端 layoutDigest。HMAC-SHA-256 keyId/version/defaults 随 request metadata 保存，不保存原文、layout 或 layoutDigest。省略标题/正文等价于空串，省略描红等价 false，文本不 trim/normalize/改换行；客户端不能提交自己的指纹。

## API 与临时执行

- submitGeneration({requestId,input,versions,layoutDigest})；digest 为 `learn-layout-v1:sha256:<64hex>`，已复用 T07 的 `validateLayoutDigest/assertLayoutDigestMatches`；版本校验复用 `validateLayoutVersions/assertLayoutVersionsMatch`。
- findJobByRequest(requestId) 返回仅当前用户的 JobSummary；jobId/requestId 不提供身份授权。
- 返回 `{job,submission:'pending'|'settled'}`。RESERVED/GENERATING 仅表示已持久元数据，不直接声称可靠已受理；初次创建路径全程 await 后才返回终态。并发重复请求可以立即查询原 pending 元数据。

仅创建者：可信预设/资源与输入检查 → 事务原子 request+job RESERVED+credit reservation+ledger+preset use+速率计数 → `prepare(input,preset)` 云端复算一次并比较 digest/page limits → 事务转 GENERATING 并记录 D-049 上海日活跃事实 → await executor(job,layout,preset)。layout/输入只存在本次内存。

准备失败是确定尚未交接：同事务 FAILED、释放额度/引用并保存安全码。executor 不确定失败或未给出终态不得伪装成功，抛 EXECUTION_OUTCOME_UNKNOWN，保留元数据供 T16 期限恢复；不自动再次调用 prepare。T15 实现真正 PDF runner，T14 用明确 fixture 验证接口，生产缺少 prepare/executor 配置时新请求拒绝创建。

## 数据/并发

新增 generation_requests（HMAC/原校验版本/失效点）、generation_jobs（安全元数据/批次/期限/状态）、generation_rate（固定服务端时间窗口的新任务计数）、daily_activity（上海日+user去重）。JobSummary 不包含原文、指纹、文件号或下载凭据。

事务先重读 request，命中立即退出不修改余额；新请求在事务内再检查窗口期限、用户状态、当期额度、account.reserved 并发限制、速率窗口与 preset state。稳定 job/batch/请求指纹在事务外生成，事务冲突重试不变。只有一个创建者获得执行权，所有其他调用只验证原指纹与读结果。

## 配置/测试

所有窗口、请求/记录/PDF 保留期、任务期限、输入/页数/PDF体积、并发/速率以及签名/HMAC key IDs 显式提供；校验期限顺序，开发 fixture 不变成生产默认。验证双击和不同参数竞态、过期清理重放、密钥轮换、Unicode/空白差异、未知字段/几何注入、跨用户查询、限额、prepare失败释放、无交接不早返、响应丢失、永久不重排重试、隐私与 D-049 活跃去重。
