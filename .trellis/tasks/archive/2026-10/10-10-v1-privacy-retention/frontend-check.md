# T23 隐私页独立检查（2026-10-11）

范围：`pages/privacy/*`、`lib/privacy-session.ts`、`test/privacy.test.mjs`、前端设计和证据，随后补查实际 App/PDF 清理链及 CloudClient 配置守卫。读取 D-051、DATA_AND_CREDITS §7.1、P07、实际 CloudClient/后端隐私响应与 App 清理契约；检查者未修改 App、兼容模块、路由、后端或 PDF 产品源码。

## Findings (fixed)

隐私页/会话本身没有产品代码问题；初次检查发现并协调修复以下接线问题：

- `miniprogram/lib/editor-environment.ts` 曾吞掉注册清理异常，隐私页无法获知部分失败。T19 所有者已改为尝试全部内置和注册所有者后，若有失败抛出固定 `LOCAL_DATA_CLEAR_FAILED`；不回显原始错误。
- `miniprogram/lib/pdf-download.ts` 曾将忙文件、目录读取失败和不存在混为成功。主会话已将公开 `clearLocalFiles()` 改为严格复核：父目录确认不存在，删除后再次列目录确认无受管残留，失败报 `LOCAL_CLEAR_FAILED`；仍有读写在途时报 `LOCAL_CLEAR_PENDING`，继续取消迟到回调并要求本地重试。启动和普通下载清理保持尽力执行。
- 检查者新增两个实际 App + CloudClient + PDF downloader + PrivacySession 的 ES2017 VM 集成回归，覆盖 busy-file 和 pending-write：删除云端只提交一次，输入与其他本地所有者仍清理，失败提示保留，迟到文件不打开，解锁后本地重试清空且不重复云端操作。
- 原 T19 `compatibility-presets.ts:33` 类型错误已由所有者修复，本次重新执行 root 严格 tsc 通过。
- 顺查 CloudClient 配置守卫新增的字符串类型判断，缺字段/null/数字不再被正则隐式转换后当作有效环境或函数名；对应 6 项客户端测试通过。

## Findings (not fixed)

本次已检查代码没有剩余阻塞。T20/T21 仍须将其最终请求/PDF 会话注册到同一 App 入口，路由/官方模拟器及实际手机文件系统另行验证；不以本次内存文件系统证明真实文件删除能力。

## Verification

- Tests: 初次隐私检查 **13/13**；补查新增真实清理链后 `node --test miniprogram/test/privacy.test.mjs` **15/15**，另实际执行 CloudClient/PDF 测试 **12/12**。实际 ES2017 Page/会话/CloudClient/App/PDF 构建在内存中运行，没有仅引用实现者旧计数。
- TypeCheck: `tsc -p tsconfig.json --noEmit` **pass**；不会写 dist。
- Lint: 仓库未配置 lint 脚本；本测试 `node --check` 和本范围 `git diff --check` 通过。
- 未运行共享 dist build、Canvas/字体全套或 DevTools；本范围不改变排版/渲染。原生模拟器、反馈接口、真机文件系统和真实 CloudBase 配置须另行验收。
- 新增真实 App bundle 带入字体依赖的既有 `axisIndex` 重复键 warning；未改变字体依赖。新增测试首次因跨 VM 的 Uint8Array 构造器不一致停在待写入夹具；修正为共享测试字节构造器，并让预期写入等待同时观察下载 rejection 后，15 项全部完成。

## 行为复核

- 原生 showModal 明确确认后才先清本地并提交 `{confirm:true}`；取消、失败、隐藏后迟到确认不执行删除；重复点击共享同一次操作。
- 只读查询不调用 getAccount、不建账户、不自动重发删除。未知删除响应保留 uncertain；后续 active 不能证明原请求失败，deleting/none 按真实查询更新。
- deleting/disabled 状态或对应机器码调用集中清理；清理失败不阻止已明确授权的云端删除，错误提示不包含原始异常。
- revision 阻止隐藏/卸载后的迟到响应更新页面；已经明确发送的云端操作继续，离页不是失败或退款依据。
- 九项期限来自服务响应、精确到毫秒，未编造默认天数；上海时间与 policyVersion/timeZone/状态组合有校验。PDF 从成功结算起算、记录从受理起算、请求窗口/执行截止后的保护描述与后端一致。
- earliestReuseAt 明确是已知最早保护下界，页面不承诺到点完成；none 区分尚未建号和已清理，无永久删除凭证。
- 正文/标题只在处理过程与私有 PDF 出现，不宣称 PDF 无正文；明确用户另存/分享文件需自行处理。页面无文本输入、原文日志、持久存储、自动轮询、提前恢复或跳转业务入口。

完成集成后建议将原生隐私确认、未知结果、集中清理失败传播与重试契约纳入前端 spec；后端 `privacy-lifecycle.md` 已覆盖可信权限及有限保护。
