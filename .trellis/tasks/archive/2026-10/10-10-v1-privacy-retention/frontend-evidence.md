# T23 原生隐私与数据页面阶段证据

2026-10-11；实现者自验，独立检查及官方模拟器集成待主会话组织。本记录不将真实配置、手机本地清理或整个 T23 验收标为完成。

## 交付范围

- `miniprogram/pages/privacy/index.{ts,wxml,wxss,json}`：P07 原生页面，数据用途与原文/PDF 区别、真实配置期限、删除流程与状态、微信反馈；原生确认后才提交删除。删除中不提供提前恢复或普通业务操作。
- `miniprogram/lib/privacy-session.ts`：单一 App.client，只读接口不调用 getAccount；服务响应安全投影；真实毫秒期限精确换算；上海时间、none/active/disabled/deleting 与 earliestReuseAt 下界。
- `miniprogram/test/privacy.test.mjs`：ES2017 中性构建、隔离 VM、实际 CloudClient 信封与实际 Page 事件回调。没有另造账户鉴权/删除服务。
- 本任务 [frontend-design.md](frontend-design.md) 描述明确确认、未知结果、集中本地清理与接入点。

## 本次验证

`node --test miniprogram/test/privacy.test.mjs`：**13/13 通过**。

覆盖动态九项期限/精确小单位/上海时间、不自动建号、缺配置不编造默认、确认取消或失败不清数据、重复确认共享、清本地在云端请求之前、删除中只读、丢响应不判失败也不自动重发、active 状态不抹掉先前不确定性、none 不伪造完成凭证、停用/删除观察清本地、集中清理失败独立重试、离页前后迟到确认与响应、坏期限/日期/状态的安全失败，以及原生确认/取消/隐藏事件。

`npx tsc -p tsconfig.json --noEmit`：当前 T19 正在接入 App 契约，privacy 页报 `LearnApplication.client/clearUserData` 缺失；同时存在 T19 自身兼容模块的三个编译错误和 admin 页相同 client 接入错误，已反馈责任者。未通过断言或修改他人文件规避；本页面与会话除此之外没有类型错误。集成后须重跑，不称本次全项目类型检查通过。

`git diff --check`：通过。新增代码不含 console、持久存储、自动轮询或自动重试删除。

## 接入与剩余验收

- T19 已确认 `App.client`、`App.clearUserData():void` 和集中清理注册入口；T20/T21 还须将生成请求与 PDF 会话注册其中，确保同步失效在途回调。privacy 页面不会另建缓存或偷偷恢复输入。
- root 注册 `pages/privacy/index`，T21 在“我的”连接入口；本轮未修改 App、路由、P04、公共脚本或后端。
- 后续官方 DevTools 对真实本地服务验证配置展示、删除申请/重查与无法重建账户、不同账户隔离及集中清理。共享 DevTools 本阶段未占用。
- 真实 CloudBase 部署保留值、权限、定时器与告警、微信反馈能力、手机文件系统清理和已另存/分享文件范围按 T24 最终交 Owner 验收。

## 独立检查

[frontend-check.md](frontend-check.md) 记录本次独立检查。首次执行实际 Page/会话/CloudClient 的 VM 测试 **13/13**；补查实际清理链新增两项后 **15/15**。语法与范围差异检查通过。隐私页和会话没有产品代码问题；首次 root tsc 的 T19 `compatibility-presets.ts:33` 错误已由所有者修复，补查 root 严格 tsc **通过**。

实际 App 清理入口与 PDF 清理器组合曾发现异常传播缺口：两层都吞掉清理错误，忙文件残留时隐私页无法收到失败信号。T19/root 已分别修复；检查者用实际 App + CloudClient + PDF downloader + PrivacySession 验证忙文件与迟到写入会保留 localClearFailed，仍继续清空输入/其他所有者且提交云端删除一次，本地重试成功后清除提示、不重新删除云端。独立执行客户端/PDF 既有回归 **12/12**。本地集成阻塞已关闭；真实手机文件系统仍须 T24。本次未使用 DevTools，也未写共享 dist。
