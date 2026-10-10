# T24 组合阶段独立检查

2026-10-11，reviewer：`foundation_check`。仅审查云函数组合、公开构建配置、独立发布包、诊断传输、CloudClient 与 PDF 下载器；未接管 T18/Canvas 或操作 DevTools/`dist/miniprogram`。T24 保持开放。

## Findings (fixed)

- File: `cloudfunctions/learn-service/test/artifact.test.mjs`
  - Issue: 产物回归只加载业务云函数，独立维护函数的入口、外部依赖和缺配置拒绝行为未被同样验证。
  - Fix: 同时在隔离 VM 加载两个真实 CJS 构建产物；包括伪造 Timer 事件时缺配置仍安全拒绝、manifest/lock 与源文件精确一致、输入无测试/诊断/原始字体，以及不含模拟身份或诊断桥。
- File: `scripts/test-release-build.mjs`
  - Issue: 先前只按路径/扩展名排除诊断页和字体，不能发现诊断桥或模拟身份被间接打进产品 JS；配置检查也未覆盖 App 实际使用的字体 URL。
  - Fix: 逐个 JS 检查已知开发身份/传输与服务端密钥标识，并核对独立字体配置和 App bundle 中的公开 URL。
- File: `composition-evidence.md`
  - Issue: 旧证据仍写未独立检查、14 项组合测试及 T17 待接，无法对应当前源码。
  - Fix: 更新为本轮结果与明确的 App/平台阶段限制。

本阶段受审业务代码未发现需要直接修复的实现缺陷。

## Findings (not fixed)

- `miniprogram/app.ts` / `lib/application.ts` 当前只有本地编辑环境，尚未持有 `CloudClient`。因此公开服务配置只是可注入的模块，`scripts/diagnostics/automator-bridge.mjs`也需要后续 App 接线后才能直接安装。主会话确认这是 T19/T20 所有权内的已知阶段任务；不改 App、不把发布结构检查当作完整应用验收。
- wx-server-sdk 的 lodash.set/unset watcher advisories 仍按 [部署 README](../../../cloudfunctions/learn-service/README.md) 记录。Learn 未使用 watcher；本轮没有完成依赖迁移或宣称完整安全审计。第三方包迁移超出组合检查职责。
- fontkit@2.0.4 生成代码仍有重复 `axisIndex` 的 esbuild warning；当前构建/测试通过。不修改第三方产物或屏蔽警告。
- `.trellis/spec/frontend/runtime-tooling.md`尚主要描述诊断构建；主会话收尾时应同步独立 `dist/release`、明确公开配置、`test:composition` / `test:release` 以及不并发改写开发目录的规则。T19 App 接线后的具体接口随所属任务更新。
- CloudBase 实际权限/数据库事务/文件 ID/断连执行/维护定时器、真实微信 PDF viewer、字体许可和实体打印均未在此阶段验收；按 D-044 留至最终 Owner 配置与验收。T22/T23 组合与全部原生页面接入亦未由本检查完成。

## Verification

- Lint: 仓库未配置独立 lint 命令；21 个相关 `.mjs` 文件 `node --check` 与 `git diff --check` 通过，不能等同于完整 lint。
- TypeCheck: `./node_modules/.bin/tsc -p tsconfig.json` 通过；组合重建中的 cloud-runtime / paper-core / cloud-service 编译通过，发布构建生成 font-metrics / Canvas 依赖。
- Tests: `npm run test:composition` **16/16**，包含真实原始字体、超过 18 MB PDF 的 JSON/base64/原生下载器往返、重复扣次与跨用户拒绝。
- Tests: `node --test miniprogram/test/cloud-client.test.mjs miniprogram/test/pdf-download.test.mjs packages/runtime-smoke/test/public-config.test.mjs` **10/10**（客户端/下载 9、公开配置 1）。
- Release: `npm run test:release` 通过；4 个当前页面，**747,081 B**，测试公开配置，独立输出 `dist/release`。仅结构、配置注入与隔离检查；App 云端接线后必须继续集成验收。
- Dependencies: 根与云函数 manifest/lock/当前安装的直接依赖精确版本一致；`node scripts/setup.mjs --list` 包含 PDF 包与云函数锁文件。未重装当前工作区，也未替代最终干净环境安装测试。
- Scope: 未运行开发构建、根 `npm test`、DevTools 或 reLaunch；没有提交、归档或将 T24 标为完成。
