# T01 开发验证证据

日期：2026-10-10。环境：macOS，Node v26.3.0，npm 11.16.0；TypeScript 5.9.3、esbuild 0.25.10 固定版本。阶段 A 已实现；设备/云端平台实测移交 [最终验收清单](../../../../../docs/FINAL_ACCEPTANCE.md)，不计为通过。

## 实际命令与结果

| 命令 | 结果 |
|---|---|
| `cd packages/paper-core && npm test`（修改前） | 编译 + 22/22 通过；已有依赖可用 |
| 根目录 `npm install` | 安装根开发工具，audit 0 vulnerabilities；生成 lock |
| 根目录 `npm test`（修改后） | 严格类型检查、paper-core 22/22、runtime-smoke 12/12、cloud-runtime 21/21 通过，共 55；cloud 21 项由并行 T11 实现 |
| `npm run smoke` | 两个目标产物在本机 Node 执行；Intl.Segmenter、Unicode 属性正则、Array.at 探测可用，各 11 个合成检查通过 |
| `git diff --check` | 无空白错误 |

运行时 12 项验证实际构建产物，不仅测试源代码：无 Node/wx 环境的导入、云侧真实 require、四模板完整几何及文字布局双端一致、段落/Unicode/多页/末格点号、缺 Array.at、缺 Intl 或 Segmenter、错误 Segmenter、缺 Unicode 属性正则、汇总不含正文、原生 App/Page 注册与重跑、工程路径有效。VM 禁止 eval/new Function 和 WebAssembly。

合成样例/覆盖矩阵与接口说明维护在 [runtime-smoke README](../../../../../packages/runtime-smoke/README.md)，不收录历史用户作文。固定测试字宽不是正式字体。

## 兼容改动

`layout.ts` 将 Intl.Segmenter 从模块初始化移至实际文字分词时创建；缺失时给出 `TEXT_RUNTIME_UNSUPPORTED`，不改变 Unicode 边界算法。末格读取使用数组下标，移除 Array.at 依赖。既有 22 个几何和排版回归全部通过，物理参数和正常运行时布局不变。

esbuild 将同一 core 源码输出为 ES2017/CommonJS（小程序）及 Node20/CommonJS（云）。ES2017 目标将 Unicode 属性正则转换为构造形式，旧环境可先载入诊断宿主并探测能力。没有对缺失分词能力作不等价回退；生产目标若缺失仍须解决或明确阻止文字导出。

## 微信开发者工具自动化

用户启用开发者工具后，官方 `miniprogram-automator@0.12.1` 已实际连接并运行诊断页。此前 CLI 返回服务端口关闭/启动超时的状态已解除；原尝试恢复了本地标记，没有修改登录或真实 AppID/CloudBase 配置。

- 可复跑命令：根目录 `npm run test:devtools`，先构建再显式进入 `--diagnostics` 合成诊断模式；固定路由 `/pages/runtime/index`，后续正式首页变更不改变该目标。
- 11 项实际页面检查的 ID、状态和诊断结果与同源云目标全部一致；将诊断数据置为测试哨兵后点击原生“重新检查”按钮，等待并验证重新计算，避免陈旧数据产生假通过。
- 公共 `miniProgram.systemInfo()` 返回模拟器基础库 **3.17.3**、模拟微信 **8.0.5**；未捕获应用异常。模拟微信版本不是 IDE 版本，官方 automator 公共 API 没有暴露 IDE 版本，本证据不混用二者。
- 脚本只输出上述安全版本、通过数和固定状态；不输出页面全文、合成原文、原始异常或登录信息。失败/超时返回非零；结束只 `disconnect()`，保持 IDE 打开。
- SDK 默认选择空闲端口，允许连续复跑；可通过 `LEARN_DEVTOOLS_PORT` 显式指定空闲端口。先前固定 9420 在断开后仍被 IDE 占用，已避免该重复执行故障。
- 主会话已取得模拟器截图 `/tmp/learn-runtime-simulator.png`；截图是本机临时证据。根 `project.config.json` 仍使用 `touristappid` 与 `dist/miniprogram/`。

本次仅证明开发者工具模拟器运行；真实 AppID、iOS/Android、CloudBase 和实体打印继续留到最终 Owner 验收。

## 交付与外部验收

- T08/T18 使用 `miniprogram` 工程入口和同源 core；诊断页路径 `pages/runtime/index`，没有正式业务 UI。
- T11 取得 Node20 语法目标的 core 构建；真实 CloudBase 部署/组件由对应任务负责。
- [最终验收清单](../../../../../docs/FINAL_ACCEPTANCE.md) 的 T01/T19 条目接收正式 AppID、目标基础库、服务端口/开发者工具、iOS/Android Unicode/共享编译验收；字体/打印另归 T02/T10。D-044 允许移交外部验收后结束开发阶段，发布仍未通过。
- 主会话负责独立检查、提交和归档；本实现子代理未提交或推送。
