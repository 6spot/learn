# T20.A 会话与安全随机独立检查（2026-10-11）

范围：`generation-session.ts`、`secure-random.ts`、两份对应测试及任务证据。已读 D-037/D-050、受理/更新/前端规范与本任务设计；未修改 App、页面、T21、后端、公共传输或共享 dist，未使用 DevTools。

## Findings (fixed)

- File: `miniprogram/lib/secure-random.ts`
  - Issue: `Object.prototype.toString` 与普通 `byteLength` 读取不能证明返回值是真实 ArrayBuffer。带 `Symbol.toStringTag='ArrayBuffer'`、length/byteLength=16 的普通对象可以被转换为 16 个零字节并生成可预测 UUID，违反坏类型拒绝契约。
  - Fix: 使用原生 ArrayBuffer byteLength getter 校验内部类型与真实长度，仍接受其他 API realm 的真实 ArrayBuffer；复制字节后设置 UUID 位。新增伪装对象及覆盖 byteLength 回归，先确认原实现错误接受，再验证修复。
- File: `miniprogram/lib/secure-random.ts`
  - Issue: API 可用性读取位于 try 之外；平台 getter 抛出异常时 Promise 会直接带出原始 provider message。
  - Fix: 将可用性读取移入安全异常边界；测试中新增抛错 getter，确认修复前泄漏合成异常、修复后固定 `SECURE_RANDOM_UNAVAILABLE`。

`generation-session.ts` 本次没有发现需要修复的实现问题，未修改其产品代码。

## Findings (not fixed)

- 本次模块范围没有剩余问题。App 会话注册/隐私清理、原生按钮的 retry/startNew 区分、T21 唯一详情导航尚属阶段 B，不能以本报告归档 T20。
- 初次 root 严格 tsc 通过；随后并行 T21 新增 records 页面产生 `LearnApplication.records` 缺失及两个 view 隐式 any，共 6 项错误，已反馈主会话。检查者没有修改这些他人所有文件；本次模块及其依赖按根严格选项单独类型检查通过。
- 前端 spec 尚需在集成时记录固定完整请求号、未知结果只查原号、明确新操作与内存清理边界；正式 wx 随机调用、页面生命周期、手机/CloudBase 验收继续由对应阶段完成。

## Verification

- Tests: `node --test miniprogram/test/secure-random.test.mjs miniprogram/test/generation-session.test.mjs` **25/25**（安全随机 4、生成会话 21），修复后重新执行。
- TypeCheck: 模块范围 **pass**；使用根 tsconfig 的严格选项，TypeScript Program 根文件限定两个模块、递归检查依赖且 `noEmit:true`。root 全项目最后一次结果受上述并行 T21 接入错误影响。
- Lint: 无配置 lint 脚本；两个 MJS `node --check` 和范围 `git diff --check` 通过。
- 只使用内存 ES2017 中性构建。测试读取当前已构建 core/font/service 及原字体；不是干净安装复现或官方模拟器证据。

## 实际路径与边界

- 双击共享进行中 Promise；真实预览完成前检查 revision，完成后冻结 input/options/version/digest；nonce 与签窗等待期间的编辑不会污染旧快照。完整号形成后不续窗、不重新随机。
- 未知提交先查原号；查询异常不重发或换号。只有查询明确 null 后的用户 retry 才重发同号同参；未知时 startNew 转成原请求查询。已知操作的 submit/retry 不重做，明确 startNew 才生成新号。
- 本地等待超时不推断 FAILED、退款或未受理；晚到可信提交/查询可恢复 known。响应必须匹配 requestId/template/jobId，pending/settled 与终态对应后才调用 onJobKnown。
- clear 撤销本地 epoch/等待/自有快照，旧响应不能回写或发起导航；不声称撤回已交给平台的请求，也不改变云端结算。
- view 无原文、布局、摘要或请求号；模块不写 storage、日志或路由。onJobKnown 只传 jobId；RESERVED 的文案只称已找到记录，不声称可靠执行交接完成。
- 实际 CloudClient + CloudService 成功响应丢失路径验证一次任务/渲染/扣费，retry 无新消费，明确 startNew 才第二次消费。该服务夹具使用合成 PDF，不能取代真实 PDF/平台集成证据。
