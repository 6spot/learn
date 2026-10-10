# T24 组合层阶段证据

2026-10-11，本地组合阶段已完成独立检查，见 [composition-check](composition-check.md)。T24 保持开放，不代表完整产品、正式发布或外部平台验收。

- `cloudfunctions/learn-service`：受控配置/秘密key map、HTTPS完整字体长度与hash核验、确定的资源下载deadline、白名单RPC、真实CloudService/排版/PDF组合；函数不记录请求或底层错误。
- `cloudfunctions/learn-maintenance`：独立固定恢复扫描入口；最终配置必须验证禁止客户端调用，事件中的Type/身份不用于授权。普通业务RPC无维护方法。
- `npm run test:composition`：本轮重建后 **16/16**。涵盖配置拒绝、秘密不回显、请求安全快照、下载损坏/超限/卡住、实际安装 SDK API/本地 HTTP 兼容、业务与维护两个独立 CJS 产物/锁文件一致性、安全启动失败、维护权限边界、PDF 块 base64；真实布局 → CloudService/PDF → JSON 传输 → 原生下载器完成超过 18 MB PDF 的完整散列核验，并验证同请求重试不重复扣次、跨用户领取拒绝与元数据不含原文。
- `CloudClient` 与原生PDF下载器：9/9本地client/download测试；native严格TS通过。256KiB块、规范base64/完整SHA256、顺序和有效期元数据核对；重复打开合并，半途错误不写文件，隐私清理取消在途下载。实际原生viewer仍需T21/T24验证。
- `npm run test:release`：本轮独立构建 `dist/release`，4 个当前页面、**747,081 B** 原始文件；检查诊断页/原始字体/PDF/map 排除、产品 JS 无模拟身份/诊断桥/云密钥标识，以及公开配置和 App 实际使用的字体 URL 注入。使用明确的虚构公开测试配置，尚非可发布应用。后续页面接入须重新验证。
- `scripts/diagnostics/local-service.mjs`：真实内存 CloudService + 原字体 + PDF 组合已初始化四套已发布开发预设，T17 记录/文件 RPC 已接通。`automator-bridge.mjs`需要 App 持有 `client`；审查时 App 仅安装本地编辑环境，T19/T20 接线属于后续任务，本轮未操作 DevTools，也未将 Node 往返测试视为官方自动化完整闭环。
- `npm run setup`范围增加PDF包与部署SDK锁文件。根`@noble/hashes@1.8.0`供原生下载hash；云SDK 4.0.2，Axios明确override0.34.0；实际本地HTTP测试通过。SDK realtime watcher的lodash.set/unset上游advisories未消除（4high/1moderate含父包传播），Learn未使用watch，详情见云函数README。
- 额外检查：公开配置拒绝测试 **1/1**；原生严格 TypeScript、21 个相关 JavaScript 文件语法、根/云直接依赖的 manifest/lock/安装版本一致性、配置示例 JSON 与 `git diff --check` 通过。仓库没有独立 lint 命令，未将语法检查冒充完整 lint。fontkit 生成代码的重复 `axisIndex` warning 仍存在，未修改第三方依赖。

尚需：T22/T23 新增接口的组合补齐；T19/T20/T21/T22/T23 页面与 App 云端接线；官方自动化真实服务桥/多账号/故障/完整下载；最终全量与干净安装/产物测试。真实云配置、权限、设备、许可、打印由 Owner 最后验收。
