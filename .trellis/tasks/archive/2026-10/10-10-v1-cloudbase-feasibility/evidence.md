# T11 本地开发证据

日期：2026-10-10。依据 D-044，本轮交付可运行代码/离线验证与最终平台清单，真实账号配置和真机验证统一由 T24 交给 Owner。

## 实际完成

- 新增 `packages/cloud-runtime` 的 TypeScript 端口、CloudBase SDK 最小结构适配、内存事务/存储/执行/时钟和身份 fixture。
- SDK 候选：`npm view wx-server-sdk version` 返回 `4.0.2`。只确认 registry 版本，没有安装/部署 SDK 并宣称平台 API 已通过。
- `cloudfunctions/runtime-example` 可组合可信身份与正式业务处理器，示例配置为空时拒绝使用；无真实环境 ID、账户、密钥或公网服务。
- 事务只持久明确元数据；合成原文始终在执行参数中。上传前登记候选路径，路径解析器是生产强制配置；云端返回 fileID 与解析结果不一致时拒绝并清理已知上传。

## 本次命令

| 命令 | 结果 |
|---|---|
| `npm --prefix packages/cloud-runtime install` | 成功，1 个开发依赖，审计 0 漏洞 |
| `npm --prefix packages/cloud-runtime test` | 独立复查后严格 TS 编译通过；25 项 Node 测试全部通过（原 24 项 + JSON 属性/序列化钩子拒绝回归） |
| `node --check cloudfunctions/runtime-example/index.mjs` | 通过 |
| `git diff --check -- packages/cloud-runtime cloudfunctions .trellis/tasks/10-10-v1-cloudbase-feasibility` | 通过 |

测试使用 Node v26.3.0；目标 CloudBase Node 运行时尚需最终实测。首次故障测试将“将 fileID 冒充 jobID”的输入预期误设为 NOT_FOUND，实际按标识校验返回 INVALID_ARGUMENT；已修正测试为验证拒绝，不放宽鉴权。

独立检查修复了 JSON 校验读取 getter、遗漏非枚举 `toJSON` 与数组额外字段的缺口。现先检查数据属性描述符，拒绝可能改变序列化结果的钩子或被静默遗漏的字段；回归验证钩子不执行、持久数据为空。完整独立检查见 [T01/T02/T11 检查记录](../../../10-10-v1-baseline-runtime/independent-check.md)。

## 故障证据映射

| 情境 | 证据 |
|---|---|
| 40 个事务争抢 1 次额度 | 只有 1 个预留，余额不负数 |
| 回调异常/提交失败 | 任务与流水整体回滚，后续事务可继续 |
| 未提交可见性/对象引用修改 | 外部读看不到未提交写，读写不共享可变对象；事务结束后写入口失效 |
| 响应丢失 | 服务端成功不反转，重复查询/下载不重复消费 |
| 调用前失败/原执行丢失 | 可信期限前等待，期限后并发恢复只释放一次 |
| 已上传但结算提交失败 | 从候选元数据核验已有文件并结算，不重排 |
| 已上传后立即模拟进程中断，未写回 fileID | 通过上传前持久候选 path 找到文件，消费一次且渲染次数仍为 1 |
| 失败终态后迟到上传 | 不复活、不消费并清理迟到文件 |
| 成功后迟到超时/旧批次 | 不退款、不反转成功 |
| 其他用户猜测任务/文件号 | 访问拒绝；文件能力只供服务端业务处理器使用 |
| SDK 异常含合成敏感文字 | 运行错误仅返回安全 code，不含原始错误文本 |
| 部署配置错误 | 环境相同、缺少路径解析、生产未验证、上传 ID 不符均拒绝 |
| 入口收到伪造身份 | 只使用 SDK getWXContext 的身份；处理器完成前入口不返回 |

## 明确局限与 T24 移交

模拟事务采用互斥串行化，不声称实现 CloudBase 隔离/冲突机制。故障夹具验证端口支持这些算法，不替代 T13～T17 的完整生产业务测试。合成 `%PDF-synthetic` 只是字节载荷，不是有效 PDF 或正式字体证明。

以下真实条件尚未验证：开发/生产环境与权限、SDK 文档不存在错误码/结果形状、事务冲突重试、fileID 路径解析、私有文件授权交付、客户端断开后云函数是否继续、平台是否存储调用正文、硬超时/资源限制与定时器。完整逐项清单位于 [cloudfunctions/README](../../../../../cloudfunctions/README.md)，由 T24 最终验收承接；不声称通过。真实限额还需 T15 接真实 PDF 后校准。
