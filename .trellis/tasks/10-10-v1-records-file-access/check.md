# T17 独立检查

日期：2026-10-11。范围为 service 记录/私有文件授权、history索引、缓存/在途合并及验证证据；未修改 root 持有的 RPC/client 或其他 worker 文件。

## Findings (fixed)

- File: `packages/cloud-service/src/records.ts`、`test/records.test.mjs`
  - Issue: 按当前job/batch查询候选后，只核对正式文件属性及候选自身路径，未核对取回记录的主键/jobId/batchId是查询目标。复制其他合法候选到此键并错配正式引用时，会误判可领取。
  - Fix: 显式检查 candidateId/jobId/batchId/userId 与当前任务一致，再核对已有文件属性。回归确认详情为unavailable，info/chunk拒绝且未读存储；另一合法任务仍可用。
- File: `packages/cloud-service/src/records.ts`、`test/records.test.mjs`
  - Issue: 单个inFlight槽会被不同文件覆盖；A/B/A交错冷请求对A重复完整读取，实际三次I/O而非两次。
  - Fix: 仅在加载存活期间按文件key保存promise，finally以同promise判断再移除；key明确含userId。跨用户交错回归核对两次read、各自精确字节、防御复制、越权拒绝及不重复消费；TTL缓存仍仅一份。

README、design、清单与evidence同步119项测试、完整候选关联以及临时并发内存边界。

## Findings (not fixed)

无遗留局部缺陷。已核对：

- 每次RPC取得可信身份；列表最终投影和文件字节加载前/后均事务复查active用户、job归属、删除binding及期限，缓存不替代授权。
- 逆时间history索引与受理同事务；103项分页无遗漏，用户绑定签名游标不能跨用户使用，过滤预算导致的空/短页仍明确返回续查游标。
- 固定256KiB块、offset快照/边界、整文件长度/hash与防御复制正确；错误不退款、不改变成功终态、不重排。
- metadata投影拒绝未知状态/error/template值；日活仅在有效块读取后的授权事务记录，不把轮询或失败请求计入。

后续责任与实际限制：

- `.trellis/spec/backend/` 的记录领取、候选完整关联和在途合并契约交主会话同步。
- 当前端口冷读整文件；单缓存容量不等于整个进程的并发临时内存上限，部署并发/内存和响应容量归T24实际配置。
- 旧数据history回填、逻辑删除后的物理GC归T23；真实存储禁止客户端直连、函数权限与真机打开仍需T24，不以模拟访问失败替代。
- 既有Fontkit axisIndex重复键警告仍出现但构建成功，第三方字体代码未修改。

## Verification

- Lint：未配置独立命令；作用域diff --check、尾空白/Markdown/JSONL目标及业务源码平台/日志扫描通过。
- TypeCheck：通过，测试包含strict runtime/core/service编译。
- Tests：`npm --prefix packages/cloud-service test` **119/119**（T17 23、T16 21、T15 22、T14 25、T13 17、T12 11）。
- Integration：`npm --prefix packages/cloud-service run test:pdf` **13/13**。田字描红18411605字节分71块，拼音165148字节/3页；完整重组hash/A4/页数正确，暖实例只整读一次，生成后不再消费。
- 未提交或归档。
