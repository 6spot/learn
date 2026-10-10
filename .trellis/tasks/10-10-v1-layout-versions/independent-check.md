# T06/T07 联合独立复核

日期：2026-10-11。范围为拼音布局、版本/摘要协议、对应核心/真实字体/双目标测试，以及Canvas统一入口代码集成。保留云服务和T18页面并行修改；未运行DevTools、提交或归档。

## 已修复

- `src/document.ts`：可信预设拒绝重复title/body style ID。此前可构造标题灰度0.2、正文0.8但同ID的预设，Canvas按ID查找会给正文取到0.2。现输入阶段明确 `INVALID_PRESET`，不生成含歧义的布局。
- `src/layout-digest.ts`：拒绝重复ID、未知glyph.styleId及与glyph.source.block不匹配的样式引用。此前不存在的style仍能生成有效摘要；现序列化/摘要阶段明确 `INVALID_LAYOUT`。
- 核心协议测试将非法style变化改为同步重命名style及其引用的合法敏感性样例，新增未知/错块/重复引用拒绝；原生和云端隔离VM同样验证安全错误。
- 拼音补充跨整页长标题、逐行对齐、CRLF空行、标题正文间距及固定第三线基线回归。
- Canvas真实字形样例改用统一 `layoutPaperDocument`，新增四模板×空白/填字/描红×双视图的多页渲染和摘要不变检查，收齐T08对T07的开发代码集成依赖；未改renderer算法。

## 审查结论

T06未发现算法缺陷。原文UTF-16范围、标题和正文、空白模式、尾空行、自动续行/分页、缩进和NFC/NFD原始输入均保持；拼音字符与组合标记使用固定白名单，非法/重复标记安全拒绝，7.4mm与第三线基线经真实MiSans Latin墨迹检查。

T07 schema逐项对应PaperLayout全部字段，拒绝未知/遗漏/隐藏/访问器/toJSON、稀疏数组、非JSON原型、符号和非法数值。页数组不能为空；版本四字段、页几何版本、源范围与样式绑定校验存在。统一入口和直接方格/拼音入口均只执行实际编译engine，不能挂旧engine标签；旧代码部署仍须真实旧包。SHA使用固定纯JS实现和ASCII字节，不依赖Node或宿主编码器。摘要用于布局一致性，不代替T14身份、HMAC参数指纹或可信复算，不保存原文或完整布局。

除已修复的样式约束外，未发现剩余本任务代码问题。约束加固不改变合法布局或摘要编码，development.4、T07固定向量和物理金样保持不变。主会话负责将统一入口/摘要和样式约束同步到paper-contracts spec。

## 实际验证

| 检查 | 结果 |
|---|---|
| paper-core `npm test` | 严格编译、**80/80** |
| paper-core `npm run test:integration` | 原字体 **12/12**（拼音5、方格7） |
| canvas-renderer `npm test` | **16/16** |
| 根 `npm run typecheck` | 通过 |
| 根 `npm run test:runtime` | 重建后 **20/20**，其中真实跨端摘要6项 |
| 作用域 `git diff --check` | 通过 |
| 独立Lint | 未配置，未声称运行通过 |

首次runtime回归因并行T18给app增加vendor require、旧测试VM缺require而失败1项；T18责任者补了白名单vendor loader后，本复核重新完整构建并验证20项全通过。没有把这次中间失败写成T07协议通过或忽略掉。

方格和拼音各4份golden重新生成后字节不变：

- square SHA-256：`1732fbf92c5226e3d2433e9bbc0cd176fd1b6d447d21d39221ce6e15aa023aac`
- pinyin SHA-256：`4f953cbcc26b630f6a0982be7980c84e4b446a97716f08b525522d0b0503ef44`

双目标真实布局在无Node/Buffer/TextEncoder/crypto/Intl/动态求值的隔离VM中具有相同规范串、摘要，并匹配测试侧独立Node SHA-256。保留上游fontkit axisIndex重复key构建警告；实际真机、正式资源/旧包发布、CloudBase、PDF对照及实体打印仍由后续/最终验收处理。
