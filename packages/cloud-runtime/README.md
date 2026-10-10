# @learn/cloud-runtime

Learn 云端服务的最小运行端口、CloudBase 结构适配和确定性离线模拟。它不依赖纸张核心、微信客户端 API 或真实环境配置；正式用户/次数/任务规则由业务服务实现。

```sh
npm install
npm test
```

`test` 包含严格 TypeScript 编译及 Node 测试。当前覆盖并发事务、回滚、可信身份、环境隔离、候选 PDF、故障恢复与 SDK 结构适配；**不证明 CloudBase 或真机验收通过**。

## 端口

- `MetadataStore.get/list/transaction`：元数据 JSON；list 默认 50、上限 100，等值过滤和 ID 游标。事务只支持单记录 get/create/set/delete，不假设平台支持事务内查询。回调可由 SDK 重试，不能排版、上传或产生其他外部副作用。
- `PrivateStorage.resolve/put/read/remove`：云端选定候选路径，上传前将路径/batch/job 写入元数据；resolve 可在上传响应丢失后重建文件引用。调用者每次鉴权并确认成功任务后才能交付文件。存储端口没有客户端授权或公开 URL 方法。
- `TrustedIdentityProvider.current`：真实实现只读 SDK 调用上下文。测试实现的 `StaticIdentityProvider` 绝不能用客户端 event 构造。
- `ExecutionBridge.invoke`：临时输入在当前调用内等待执行完成；无队列、持久输入或返回后继续运行的 promise。响应丢失是未知结果，不构成失败结算依据。
- `Clock.now`：服务端时钟或可推进的模拟时钟。

通用 JSON 检查只确保可序列化，并不能自动判断内容隐私；服务必须用明确的允许字段投影写入元数据。不能把输入 event、正文、标题或布局原样传给 store。安全运行错误只包含 code，不附带原始 SDK 错误文本。

## 适配与模拟差别

`MemoryMetadataStore` 通过串行互斥、复制和整体替换提供确定性事务。它验证服务算法原子性，不模拟 CloudBase 冲突/隔离机制。`failNextCommit()` 注入提交失败；`snapshot()` 仅供测试检查持久数据。

`CloudBaseMetadataStore` 接受 SDK 最小结构接口；不存在文档的异常必须按真实 SDK 代码显式注入判定，默认不把任何异常视为不存在。`CloudBasePrivateStorage` 必须提供实测的 path→fileID 解析器，否则无法构造；上传结果不符会拒绝且清理已知上传产物。SDK 实测与部署清单见 [cloudfunctions](../../cloudfunctions/README.md)。

`test/execution.test.mjs` 中的合成任务/账本只是验证运行端口的故障测试夹具，不是生产状态机，不可从测试复制成另一套业务逻辑。正式 T13～T17 应复用此处端口并覆盖完整规则。
