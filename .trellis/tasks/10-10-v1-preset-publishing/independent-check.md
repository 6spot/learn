# T12/T13 独立复核

日期：2026-10-11。范围为 `packages/cloud-service`、T12/T13 任务证据，以及根目录 `test:service` 验证入口。未修改其他并行任务代码。

## 已修复

- `packages/cloud-service/src/credits.ts`：`settleCreditInTransaction` 增加运行时结算 outcome 白名单。此前误传任务状态 `failed` 会把预留数减一，却未计入消费或释放，导致账本不守恒；现在写入前返回 `INVALID_ARGUMENT`。
- `packages/cloud-service/test/identity-credits.test.mjs`：新增非法 outcome 不改变任何存储、随后正常消费仍守恒的回归测试；补充旧月释放发生在新月首次账户读取前的顺序覆盖。
- 根目录 `package.json`：新增 `test:service`，供集成阶段调用本包验证；未加入全量 `test` 链。

## 复核结论

T13 已检查可信身份、HMAC 内部用户号、配置冻结、每次鉴权、上海时区月份、只发一次、不可变流水和跨月预留结算。T12 已检查完整版本组合不可覆盖、实际资源字节和 hash、云端支持/客户端就绪顺序、生产验收声明、唯一 active、退休/移除/引用保护及 tombstone。除以上额度校验问题外，未发现本任务范围内需修复的代码问题。

T12 引用原语尚需由 T14～T16 与生成任务在同一事务中组合；这属于后续任务，未表述为已有完整作业流程。规范已规定事务结算与状态边界，此次修复使实现遵守现有规则，无新产品决定。

## 实际验证

- `npm run test:service`：28/28 通过（T13 17；T12 11），包括 cloud-runtime/paper-core/cloud-service 严格 TypeScript 编译。
- 作用域内 `git diff --check`：通过。
- cloud-service 源码 `console.`/`node:`/`wx.`/文件系统导入扫描：无匹配。
- Lint：无独立脚本，未将其写成已运行。

本次采用真实业务代码和内存适配，未验证实际 CloudBase SDK、部署权限、线上并发与冲突、正式组件配置、字体授权及真机/打印效果；这些按 Owner 要求留至最终验收。
