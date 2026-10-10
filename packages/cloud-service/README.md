# @learn/cloud-service

Learn 的实际云端业务服务，使用 `@learn/cloud-runtime` 端口。模拟器与真实云函数复用这里的逻辑；源码不导入 Node、微信 API 或文件系统。

```sh
npm install
npm test
```

构建会先构建本地 cloud-runtime 和 paper-core。测试使用注入的内存事务、可控时钟和测试 HMAC provider；测试密钥只存在测试文件中，不进入业务包。

## T13 身份与免费额度

公共接口为 `CloudService.getAccount()`，返回 `AccountResponse`：userId、isAdmin、period、available、reserved、monthlyGrant、periodEndsAt。每次从可信身份 provider 获取上下文，不接受客户端指定身份或余额；存储只保留以稳定服务端密钥导出的内部用户号，不保留原始 OpenID。

配置必须显式提供 stage、monthlyFreeCredits、quotaTimeZone=`Asia/Shanghai`、identityKeyId、adminUserIds。不存在生产测试默认值。测试中的 20 次/月仅为测试夹具；identityKeyId 长期稳定，轮换必须配套身份映射迁移。

每月一个免费桶。首次访问本月时赠送一次，未访问月份不累积。跨月时旧桶可用余额过期，原预留留在旧桶；旧任务释放进入旧桶的过期余额，不增加新月份 available。返回的 reserved 汇总所有月份仍未结算的预留。

`credits.ts` 的事务原语只供后续任务服务内部组合，不从包入口导出为客户端操作。T14 已把任务创建和 reserve 原语放在同一事务；T15/T16 必须在同一事务校验任务终态、执行批次与期限后才 settle。余额与确定操作号的不可变 ledger 同事务写入。

实际 CloudBase 权限、事务并发、时钟与生产配置仍需最终 T24 验证。运行层配置清单见 [cloudfunctions](../../cloudfunctions/README.md)。

## T12 可信预设注册

- `publishPreset(preset, acceptance?)`：管理员发布不可变组合，验证四模板几何以及云端字体实际字节 hash/长度。
- `activatePreset(versions)`：原子切换一个模板的唯一当前版本；云端支持/发布先完成，服务端客户端发布记录就绪后才能启用。
- `getCompatibility({engineVersion,lockedVersions?})`：返回 engineSupported、current、locked、serverTime。各 availability 分别为 ready/update-required/retired/resource-unavailable/not-found；旧编辑版本仍受支持时不会被当前默认切换替代。
- `retirePreset/removePreset`：退休禁止新使用，移除仅允许已退休且没有在途引用；删除预设载荷后保留 tombstone 和审计，不删除可能共享的字体文件。

服务配置启用 `registry: {cloudEngineVersions,clientReadyEngineVersions}`，依赖注入 `resources.describeBundle/readFontBytes`。字体描述沿用 T04 的 id/bytes/sha256/fontVersion，添加可信部署 location；字体原始字节加载由部署方提供，不存在远程 metrics JS。`CryptoPort.sha256` 用于字体和注册表键校验，与 T07 布局摘要协议不同。

生产 publish 必须是 validated-release，并由当前已鉴权管理员提交 `{fontLicense:true,print:true,resources:true,evidenceId}`；这是一项需真实证据支持的管理操作，测试中的合成 acceptance 不能当正式验收。开发候选只允许 development 服务，不能通过客户端 stage 改变。

内部 `retainPresetInTransaction/releasePresetInTransaction` 与任务事务组合，按 jobId 幂等持有；退休后已有持有可由 `loadPresetForJob` 读取，新增任务被拒绝。清理与持有共享 state 文档并检查引用数，避免竞态删除。物理字体资源始终由部署方保留，注册 API 不提供绕开任务引用的文件删除能力。


## T14 签名请求、幂等与任务受理

`getSubmissionWindow()` 返回绑定当前可信用户的 `{windowId,expiresAt}`。客户端用可靠平台 UUIDv4 调用 `createRequestId(windowId,secureNonce)`，得到包含签名时间窗的完整请求号；首次提交后固定该号与参数快照。新窗口产生新请求号，不存在给旧裸 UUID 续期的独立 token。

`submitGeneration({requestId,input,versions,layoutDigest})` 返回 `{job,submission:'pending'|'settled'}`。初次创建会等待执行器终态；并发同参重试可以读取 `pending`，它仅表示持久化任务元数据，不能解释为已完成可靠交接。结果不确定时抛 `EXECUTION_OUTCOME_UNKNOWN`，客户端以 `findJobByRequest(requestId)` 查询原任务，不能直接退款或换号自动重试。JobSummary 只含任务号/请求号/模板、状态、时间、页数、安全错误码及文件有效期，不含正文、布局、指纹或文件标识。

同号同参按原密钥、规范化版本、默认选项和输入限制校验，命中原任务后不再复算/执行，不受后来窗口到期、默认预设切换或限制收紧影响。异参返回 `IDEMPOTENCY_CONFLICT`；已清理且原签名窗口到期的号返回 `REQUEST_EXPIRED`。仍有去重墓碑但可见记录已删除/到期时返回 `RECORD_EXPIRED`，缺旧密钥或未知指纹版本明确拒绝，绝不重新消费。标题/正文空格、换行及 Unicode 原始形式均纳入带密钥指纹，不保存原文或裸布局摘要。

新任务在同一事务绑定请求、任务 RESERVED、额度预留/流水、预设引用和速率计数。仅创建者执行 preparer；共享 `validateLayoutVersions/assertLayoutVersionsMatch/assertLayoutDigestMatches` 校验完整组合及实际布局摘要，随后转 GENERATING 并记录上海日活跃事实。prepare 失败原子释放；executor 不确定失败保留预留和状态供恢复处理。

启用 `generation` 后以下字段必须全部显式提供；没有生产默认值：

```ts
{
  windowKeyId, retainedWindowKeyIds,
  fingerprintKeyId, retainedFingerprintKeyIds,
  fingerprintVersion: 'learn-request-v1',
  windowTtlMs, requestRetentionMs, recordRetentionMs, pdfRetentionMs,
  jobTimeoutMs, maxInputCodeUnits, maxGraphemes,
  maxPages, maxPdfBytes, maxConcurrentJobs,
  rateWindowMs, maxStartsPerWindow
}
```

数值均为正安全整数且不超过 10,000,000,000；当前密钥必须在对应保留清单中，清单各为 1–32 项。请求保留期至少覆盖记录保留期及窗口时长＋任务期限；记录保留期至少覆盖 PDF 保留期＋任务期限。请求记录的 `retainUntil` 从窗口结束/任务期限中较晚者再加请求保留期；未终态任务不得按可见记录期限隐藏。部署必须保留仍被窗口或记录引用的旧密钥。

依赖注入 `preparer` 与 `executor` 才能创建新任务。`createPaperPreparer(loadVerifiedMetrics)` 直接复用 `createPaperDocument → layoutPaperDocument → createLayoutDigest`，度量加载器负责读取同版已验证字体。执行器接收只存本次内存的 `{jobId,batchId,userId,published,layout}`，必须等待全部执行并提交终态，不保留正文供后台自动重试。

当前测试覆盖 25 项受理行为，并用真实共享核心验证四模板空白复算；执行器为明确标注的合成 fixture。实际 PDF 执行、`maxPdfBytes` 约束与成功结算由 T15 接入，期限恢复由 T16、清理与密钥保护由 T23 接入；真实 CloudBase 调用生命周期、隔离性和组件参数仍在 T24 验收。
