# T07 本地实现与双目标证据

日期：2026-10-11。实现及独立复核修复完成；不是设备、CloudBase部署或打印发布验收。

## 实现

- `engine.ts` 提供当前真实编译版本 `learn-engine-dev.4`。统一入口及直接方格/拼音入口均拒绝其他engine，不能把当前算法输出标成旧版本。T12保留旧版本元数据/资源；实际多引擎部署必须同时保留对应代码包，核心不会下载执行代码。
- `layoutPaperDocument` 校验锁定文档/可信预设/实际内核/字体bundle再分派唯一四模板布局。完整四字段版本验证/相等与显式可信支持列表校验均提供给上下游。
- `serializePaperLayout` 的完整固定schema覆盖所有页/格线/行/源映射/slot/glyph/style字段；按ASCII key排序、数组保持顺序，数值不二次移动/舍入，-0为0。未知/缺失字段、隐藏属性、访问器、toJSON、非JSON原型、稀疏数组、符号、NaN/Infinity/溢出及非法绑定安全拒绝。
- SHA-256协议固定 `learn-layout-v1:sha256:<64位小写hex>`。串是ASCII限定字段组成的UTF-8子集；哈希库固定@noble/hashes1.8.0，只传入Uint8Array，不使用Node/Buffer/TextEncoder/系统crypto。
- T14已确认 `prepare(input,trustedPreset)->{layout,digest}` 端口可直接组合上述API；布局/摘要不落库。HMAC参数指纹仍是不同机制，不用布局摘要替代鉴权、原文参数保护或云端重新计算。

## 实际运行

| 检查 | 本轮结果 |
|---|---|
| 实现阶段根 `npm test`（含strict编译、构建） | 当时核心78 + runtime19 + cloud-runtime25 + cloud-service46 = **168/168**；不是后续并行代码的最新全量结果 |
| 独立复核核心 `npm test` | 严格编译及 **80/80**通过，固定摘要向量不变 |
| 独立复核 `npm run typecheck` / `npm run test:runtime` | 类型检查通过；重建双目标与原生宿主，runtime **20/20**通过（T07真实摘要6项、原runtime13项、并行新增SDK1项） |
| 根 `npm run test:layout` | 真实四模板字体集成 **12/12** |
| 核心协议测试 | 独立复核后10项；固定向量、独立Node crypto、33种字段变更、插入顺序/-0、非法输入/样式引用、版本/资源/摘要错误、锁定预设过渡 |
| 新增双目标真实协议测试 | 6项；四模板空白/填字/描红多页、临界英数、D-025、Unicode组合调号和独立错误分类 |
| `git diff --check` | 通过 |
| Canvas统一入口集成 | **16/16**通过；真实字体样例改用layoutPaperDocument，新增四模板/空白填字描红/多页双视图下摘要不变验证 |

两端实际产物来自根 `scripts/build.mjs`：miniapp ES2017/CommonJS、cloud Node20/CommonJS。新VM测试加载两个core和两个真实字体provider构建，显式禁用TextEncoder/TextDecoder/Buffer/crypto/Intl/Array.at及动态字符串求值，输入在目标realm中构建。所有实际字体全文布局规范串逐字节相等，摘要相等并匹配独立Node标准SHA-256。Node只在测试加载资源和独立验算，不进入核心/字体执行依赖。根构建成功保留无Node的可加载产物；无需修改根构建策略。

既有T05/T06物理布局金样不含版本标签，升级engine后全部原样通过。T07自己的协议固定向量含dev.4版本，后续版本变化须明确评审更新；不能将版本差异误作版式几何变化。

构建仍有上游fontkit重复axisIndex key警告，无本轮构建或测试失败。初期摘要格式检查发现JS `$`可容忍末尾换行，已用精确长度和完整标识匹配消除，并纳入拒绝测试。

## 独立复核修复

发现未知glyph.styleId仍能生成摘要、以及标题/正文重复style ID可能令渲染器取错灰度。现于可信预设拒绝重复ID，协议同时拒绝重复ID、未知ID及跨原文块的错误style引用；摘要敏感性样例改为合法地同时重命名style和引用。新增核心与两端错误回归。此为既有绑定约束加固，development.4的合法布局、固定摘要向量与全部物理金样不变。

完整范围、最新运行时结果及最终验收边界见 [联合独立复核报告](independent-check.md)。

## 限制与后续

官方DevTools字体/Canvas模拟证据在T08；本T07双目标证据是隔离VM，不冒充真机或真实CloudBase环境。原始字体/打印/嵌入许可与正式版本发布条件仍在[最终验收](../../../../../docs/FINAL_ACCEPTANCE.md)。元数据支持列表不等于部署旧代码；上线的旧引擎过渡必须保留实际对应包，不能仅添加版本标签。T09/PDF只消费统一布局并逐字形绘制；T14继续使用独立HMAC、身份与额度事务。
