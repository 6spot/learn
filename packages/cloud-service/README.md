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

`credits.ts` 的事务原语只供后续任务服务内部组合，不从包入口导出为客户端操作。T14 已把任务创建和 reserve 原语放在同一事务；T15 已在同一事务校验任务终态、执行批次、期限及预留 pending 后才 settle；T16 恢复复用同一原语。余额与确定操作号的不可变 ledger 同事务写入。

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

T14 的 25 项受理测试用明确标注的合成执行器隔离验证；T15 已另接实际 PDF 执行、`maxPdfBytes` 与事务结算并通过真实四模板集成。T16 已接期限恢复与可续接扫描，保留与密钥保护由 T23 接入；真实 CloudBase 调用生命周期、隔离性和组件参数仍在 T24 验收。


## T15 私有 PDF 执行与结算

`createGenerationExecutor(dependencies,serviceConfig)` 创建供 `CloudService` 注入的真实执行器。dependencies 包含 `store,clock,crypto,storage,bridge,renderer`；前五项复用运行端口，renderer 为可信服务端能力：

```ts
const executor = createGenerationExecutor({
  store, clock, crypto, storage, bridge,
  renderer: {
    async render(execution, { maxOutputBytes }) {
      const provider = await loadVerifiedMetrics(execution.published.preset);
      return renderPdf(execution.layout, provider, { maxBytes: maxOutputBytes });
    },
  },
}, serviceConfig);
```

`bridge.invoke` 全程 await；只允许一个调用持久 claim 当前任务后渲染。同批重复 callback 不重新渲染/上传；一个没有开始的重复 bridge 调用也不能取消另一个正在执行的调用。配置沿用 `generation`，没有新增生产默认值。

渲染后先计算完整 bytes/hash，并事务登记 `pdf_candidates` 的确定路径/文件号、job/batch/user、预期 bytes/hash/pages 和原 PDF 保留期，同时写 job.candidatePath；登记确认前不上传。上传后通过登记 fileId 回读并核对完整字节。服务只作 PDF 头尾信封检查；实际结构由可信 T09 编码器保证，测试另解析 PDF 核对页数/A4。上传响应丢失仍可回读；读失败/暂时不存在/未知提交结果保留预留，不擅自退款或重渲染。

核验通过后，事务再次读取任务、候选与预留，检查当前 batch、GENERATING、deadline、pending reservation 及候选绑定，同时提交 SUCCEEDED、正式私有引用与有效期、消费流水、预设引用释放和 candidate.committed。已知渲染/无效 PDF/超限/损坏失败原子释放；失败/超时与成功竞争只选一个终态。客户端只能在成功事务后领取，文件标识本身不构成授权。

候选清理先在事务 claim deleting：同批未终态和成功引用受到保护，只有失败/旧批/缺任务可删；删除后保留 deleted 墓碑。迟到上传完成会再次安全删除，删除失败留下可重试状态。T16 恢复会重扫 deleting/deleted 候选，避免删除后仍有迟到上传的窗口；不能立即丢掉墓碑，也不能调用 renderer 自动重排。内部 `verifyCandidate/settleCandidate/cleanupCandidate` 供可信恢复服务组合，不是客户端命令。

```sh
npm test       # 119 项服务行为测试，含 T15 22、T16 21、T17 23 项
npm run test:pdf # 构建共享原字体/PDF，13 项真实 PDF 与内存存储/事务集成
```

真实四模板 blank/text、三页拼音和超限不保存 partial bytes 均通过。当前测试文字 PDF：作文约 5.5 MB，含标题和中文描红的田/米约 18.4 MB，拼音约 162 KB；完整原 TTF 嵌入会显著影响资源上限。64 MiB 为集成测试上限，1 MB 为故障 fixture，均不作为生产配置承诺。正式存储、函数内存/超时、私有权限和断连生命周期由 T24 最终实测。


## T16 可信恢复与持续分页

维护组合使用 `createRecoveryService({store,storage,clock,crypto}, recoveryConfig)`；依赖没有正文、布局、字体、preparer 或 renderer。这个接口只供受控维护函数持有，不接普通客户端 RPC，也不以请求事件中的角色/触发类型作为授权。

```ts
const recovery = createRecoveryService({ store, storage, clock, crypto }, {
  pageSize, maxRecordsPerRun, maxRunMs, maxCandidateBytes, maxReadBytesPerRun,
});
await recovery.runSweep();
// 后端诊断需要时：await recovery.recoverJob(jobId)
```

五项配置全部显式提供：pageSize 为 1–100，maxRecordsPerRun 为 1–1,000，其他为正安全整数；各值不超过 10,000,000,000，单轮读取预算至少等于单候选上限。读取预算不足返回 READ_LIMIT 并保留任务，不把配置变小当作失败依据。`maxRunMs` 是记录边界的软预算：控制是否开始下一条记录，已开始的单条处理继续完整 await，再保存检查点，不取消半截结算。实际 I/O 可超过软预算，部署函数期限须保留单条处理和检查点余量，未知超时由下轮幂等恢复。读取预算按登记的预期字节累计，不声称可限制损坏存储对象返回前的实际内存分配。

`recoverJob(jobId)` 返回 `{jobId,status,outcome,reason}` 安全投影。未到期任务只核验当前 pending 候选，完整且关联/期限有效才复用 T15 事务补成功。无候选、暂时不可读或不完整文件保持 pending；没有外部可信中断证明时等到 job.deadline，再事务重新核对当前 batch/期限并失败释放。过期或失败任务不能凭后来找到的 PDF 复活，成功任务不退款。

`runSweep()` 顺序扫描 RESERVED、GENERATING 和全部候选；每次保存 `maintenance_cursors/recovery_v1` 中的 schemaVersion/revision/phase/afterId。记录数、时间或读取预算耗尽即续接下一调用，完成一轮才回到起点；随机新 ID 落在已过游标之前时由下一轮处理。检查点事务比较 revision，竞争失败的调用不会回退已保存进度；崩溃后允许幂等重扫。单记录异常计数后继续，下一完整周期再试；列表或检查点故障返回安全 INTERNAL_ERROR，不声称扫描完整。

返回 `visitedJobs,visitedCandidates,reconciledJobs,pendingJobs,cleanedCandidates,protectedCandidates,retryableRecords,recordErrors,expectedReadBytes,startedAt,finishedAt,cycleComplete,checkpointSaved,nextCursor`。计数仅代表本轮观察/尝试，不能当去重运营统计。候选相会反复处理 deleting/deleted 墓碑，删除失败保留重试状态；成功引用/同批在途文件受保护，损坏路径关联不能用于删除其他私有对象。T16 不删除请求指纹、可见记录、候选墓碑或成功 PDF；期限 GC 由 T23 实现。

21 项 T16 测试包含 107 个任务跨轮分页、后插 ID、读/时间/记录预算、并发检查点、提交/响应丢失、存储瞬态错误、迟到 put 和损坏状态的安全投影。真实三页拼音 PDF 的结算中断恢复也通过，未增加 prepare/render/upload 调用。真实调度频率、函数权限、触发可靠性和 CloudBase 生命周期仍需 T24 配置验收。


## T17 记录与私有 PDF 分块领取

CloudService 在每次调用获取可信身份，历史查询不依赖当前生成内核兼容、字体资源或执行器。注入 `storage` 并显式配置 `fileAccess: {maxFileBytes,maxCacheBytes,cacheTtlMs,maxListScanRecords}`；字段为受控非负/正安全整数且不超过 10,000,000,000，maxCacheBytes 可为0禁用缓存，其余必须正数，maxListScanRecords 不超过1,000。生产上限与缓存内存由最终配置确定，没有隐藏默认值。

| 方法 | 返回 |
|---|---|
| `listJobs({cursor?,limit?})` | `{items:JobDetail[],nextCursor:string|null,serverTime}` |
| `getJob(jobId)` | JobSummary 原字段加 `delivery: not-ready/ready/expired/unavailable` |
| `getPdfInfo(jobId)` | `{jobId,bytes,sha256,pageCount,expiresAt,chunkBytes:262144}` |
| `readPdfChunk({jobId,offset})` | `{jobId,offset,nextOffset,totalBytes,sha256,expiresAt,bytes:Uint8Array}` |

列表默认20项、单页最多50项，按提交时间倒序，同毫秒以jobId稳定排序。HMAC游标绑定可信user和索引位置，不能跨用户使用。过滤过期/逻辑删除记录最多扫描 maxListScanRecords 项，可能返回空/短页且 nextCursor 非空；客户端继续该游标，不把短页当成完整历史。JobDetail 的 ready 表示成功正式引用满足领取条件；实际存储错误仍在读块时明确报告。

新受理在同一事务写 `generation_history` 逆时间索引，仅含 userId/jobId/createdAt；索引不授权，列表重新读实际任务和请求binding。**T17之前创建的数据必须先回填索引才能宣称列表完整**：可信迁移可遍历旧任务并在事务调用内部 `indexJobInTransaction`，该原语幂等。首次部署尚无旧数据；已有开发环境或升级部署由维护流程回填并记录证据。T23 的记录GC同时处理history索引，不能删除仍需查询的在途任务。

PDF 只从 SUCCEEDED 的正式引用领取，并检查 committed 候选的主键/jobId/batchId/归属以及路径/文件号/hash/大小/页数绑定；从正确数据库键读取并不替代对记录内容的关联校验。每块读取之前和 await 字节/hash之后都在事务复查active账户、任务归属、请求删除墓碑、记录/文件有效期以及原正式引用。候选、跨用户、已删除/失效记录均拒绝；文件过期、丢失或读取失败不改变成功终态、不退款、不自动重排。接口从不返回 fileId、URL、参数指纹、正文或输入标题。

offset 必须是从0开始的256KiB倍数且小于总长；固定块上限 `PDF_CHUNK_BYTES=262144`，末块 nextOffset=null。客户端按offset组装并核对总bytes/SHA-256再打开；云函数RPC层将Uint8Array转base64，小程序不能假设wx.cloud JSON支持原生二进制。有效块读取才记录D-049活跃事实，metadata/轮询/失败请求不记；同用户同日与生成事实去重，任何重复下载不消费额度。

当前存储端口仅支持整文件读。冷请求完整核对长度、SHA-256及PDF信封后，实例内缓存至多一个文件，key绑定userId/job/batch/fileId/bytes/hash，容量不超过maxCacheBytes。同文件并发冷读取合并；仅在加载期间按key保留promise，即使不同文件交错也不覆盖其他在途加载，完成/失败后以同一promise检查并移除。缓存仍只有一份TTL副本，不形成永久多文件缓存；并发不同文件的临时内存还须受最终平台并发/内存配置约束。缓存只在cacheTtlMs和fileExpiresAt内复用（到期在下次访问惰性丢弃），返回块为防御复制。每块重新授权，缓存不延长访问；T23先逻辑撤销再物理清理可立即拒绝缓存读取。冷实例仍会整读，未声称CloudBase Range能力或真机性能已验证。

常见安全错误：FILE_ACCESS_UNAVAILABLE（未配置）、FILE_NOT_READY、FILE_EXPIRED、FILE_UNAVAILABLE、FILE_LIMIT_EXCEEDED；记录不存在/过期仍用NOT_FOUND/RECORD_EXPIRED。新任务索引/额度绑定的原子性、103条历史分页、跨用户/恶意offset/读后撤销、缓存/完整哈希均有测试。真实18,411,605字节田字描红PDF以71块重组、三页拼音PDF领取通过；暖实例均只整读一次。真实存储直连规则、云函数响应大小、缓存内存和微信打开留T24。
