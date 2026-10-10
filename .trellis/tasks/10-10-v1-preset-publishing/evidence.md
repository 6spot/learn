# T12 预设注册与兼容验证证据

实现日期：2026-10-10；独立复核：2026-10-11。实现位于 `packages/cloud-service/src/presets.ts`，公共入口 `CloudService` 每次鉴权。

## 本次命令与结果

- `npm install --prefix packages/cloud-service`：增加本地 paper-core 依赖，审计 0 漏洞。
- `npm run test:service`：cloud-runtime/paper-core/service 严格编译通过，28 项测试全通过；其中 T13 17 项、T12 11 项。
- T12/task 与包 Markdown 相对链接、空白检查通过；业务源码无 node:/wx/日志语句。
- 无单独配置的 lint 命令；独立复核未发现额外的 T12 代码问题，详细结论见 [T12/T13 独立复核](independent-check.md)。

首次构建发现 core 缺少 package exports/types，已由核心责任者按职责补齐；本任务未修改纸张算法。

## 新增测试覆盖

1. 重复发布同一 tuple 拒绝，不可覆盖原始预设；并发激活后仅一个 active，读取结果外部修改不改变存储。
2. 四个管理操作逐次使用可信身份；伪造 role/userId 均无效。
3. 伪造格宽由 core 拒绝；缺少实际要求的字体和未知 bundle 拒绝发布。
4. 激活不存在版本失败；未部署 cloud engine 拒绝发布；client-ready 尚未配置时不切 active。
5. 生产拒绝 development-candidate，即使提供测试 acceptance；validated-release 必须由已鉴权管理员明确 fontLicense/print/resources/evidenceId。
6. 开发环境已发布的候选不能因切换服务 stage 自动变成正式批准版本。
7. 字体字节长度/hash 漂移及资源位置描述变化均标资源不可用，不静默替换。
8. 当前 active 切到新内核后，仍被云端支持的旧 locked tuple 保持 ready，而当前默认明确要求更新。
9. active 不能退休；在途 held job 在退休后仍可加载旧预设，新持有被拒绝；refs 非零不能移除，20 次重复释放只减一次；移除 tombstone 阻止同版本复活覆盖。
10. 30 次并发持有按 10 个 jobId 只计 10 次，退休/移除不能越过引用保护。
11. 激活事务提交故障不改变原 active，也不产生部分成功审计。

## 已有接口和移交

类型见 `packages/cloud-service/src/contracts.ts`：`getCompatibility` 返回 engineSupported/current/locked/serverTime，各项 status 为 ready/update-required/retired/resource-unavailable/not-found。ready 带完整可信预设和已有 T04 字段加部署 location 的字体描述。publish/activate/retire/remove 是最小管理员 API，不是 CMS。

T14 将 retain 原语与新任务/预留同事务；T15/T16 终态时 release。物理字体文件由部署方保留，注册表移除只删除预设载荷，保留审计和 tombstone，不提供绕开引用保护的字体删除入口。

## 未验证

本测试的字体是用于字节 hash 校验的合成载荷，production acceptance 也是测试夹具，不代表字体有效/已获许可/已打印。正式资源 URL、CloudBase 权限与冲突、最终字体/样张/T07 跨端一致性由 T24 最终实测；这些不影响本地 API 与后续任务继续实现。
