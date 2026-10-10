# 字体资源

已取得 D-031 指定三种 Regular 原始开发候选，可恢复并重复校验。它们不是正式发布的 `fontBundleVersion`；最终字重/字号/灰度、MiSans 分发/子集嵌入许可和实印仍待验收。字体分配以 [PAPER_ENGINE](../../docs/PAPER_ENGINE.md#首版字体分配与描红d-031) 为准。

| 字体 | 字体内版本 | 本地文件 | 原始大小 |
|---|---|---|---|
| MiSans Regular | 4.009 | `files/MiSans-Regular.ttf` | 8,122,324 B |
| MiSans Latin Regular | 4.007 | `files/MiSansLatin-Regular.ttf` | 217,756 B |
| LXGW WenKai GB Regular | 1.522 | `files/LXGWWenKaiGB-Regular.ttf` | 25,819,540 B |

[manifest.json](manifest.json) 是来源 URL、原文件名/压缩包成员、大小、版本和 SHA-256 的唯一清单。原始 ZIP 在 `downloads/`，字体未修改、子集化或转换；字体、下载包及本机工具环境均由 [.gitignore](.gitignore) 排除。三份 TTF 合计 34,159,620 B，不是已验收的小程序包体积方案。

供 T03/T04 接口使用的稳定字体 ID 为 `misans-regular`、`misans-latin-regular`、`lxgw-wenkai-gb-regular`；本地候选集合 ID 为 `learn-fonts-2026-10-10-candidate.1`，不表示已发布生产字体组合。

## 新 checkout 恢复

在仓库根目录运行（Python 3.9+）：

```sh
python3 assets/fonts/tools/font_resources.py restore
# 本机没有下载包时，允许只下载缺失的清单资源：
python3 assets/fonts/tools/font_resources.py restore --download
python3 assets/fonts/tools/font_resources.py verify --hashes-only
```

恢复默认不访问网络。`--download` 从清单官方地址取得缺失资源，验证原始包/字体/许可证散列后原子写入；已有文件从不覆盖，散列不符则报错。上游原址可能更新，不能修改散列来静默接受新文件，应核对新版本并另行验收组合。`--root <目录>` 可检查带同一 `manifest.json` 的独立副本。

| 官方入口 | 正确资源与恢复位置 |
|---|---|
| [小米下载页](https://hyperos.mi.com/font/download) | `MiSans.zip` 中 `MiSans/ttf/MiSans-Regular.ttf` → `assets/fonts/files/MiSans-Regular.ttf` |
| [小米下载页](https://hyperos.mi.com/font/download) | `MiSans_Latin.zip` 中 `MiSans Latin/ttf/MiSansLatin-Regular.ttf` → `assets/fonts/files/MiSansLatin-Regular.ttf` |
| [霞鹜文楷 GB v1.522](https://github.com/lxgw/LxgwWenkaiGB/releases/tag/v1.522) | 非 Mono `LXGWWenKaiGB-Regular.ttf` → `assets/fonts/files/LXGWWenKaiGB-Regular.ttf` |

必须保留 [MiSans 许可证原件](licenses/MiSans-License.pdf) 与 [LXGW OFL 原件](licenses/LXGWWenKaiGB-OFL.txt)。分发、嵌入与署名要求见 [逐用途核对](licenses/review.md)。MiSans 不是 OFL，字体 `fsType` 不替代许可。

## 完整检查与实际结果

字体解析使用单独安装的固定 fontTools，仅用于本地工具：

```sh
python3 -m venv assets/fonts/.venv
assets/fonts/.venv/bin/python -m pip install -r assets/fonts/tools/requirements.txt
python3 -m unittest discover -s assets/fonts/tools -p 'test_*.py'
assets/fonts/.venv/bin/python assets/fonts/tools/font_resources.py verify --archives --allow-coverage-gaps --report assets/fonts/verification/coverage.json
```

`--archives` 额外要求两 ZIP 存在，检查原始散列及全包 CRC；普通开发副本可省略。报告没有绝对机器路径或时间戳，可字节对比重跑。省略 `--allow-coverage-gaps` 的严格模式会因已发现的候选缺字返回非零；该开关只允许记录缺口，**不会把覆盖结论改成通过**。

2026-10-10 真实结果见 [coverage.json](verification/coverage.json)：7 个资源（3 字体、2 许可证、2 ZIP）大小/散列及 ZIP CRC 通过；TTF 表目录、名称和版本可读。合成集合由工具枚举，不含用户正文。

| 检查集合 | MiSans | MiSans Latin | LXGW WenKai GB |
|---|---:|---:|---:|
| GB2312 一级 + 二级汉字 | 6,763 / 6,763 | 非汉字用途 | 6,763 / 6,763 |
| 基本 CJK U+4E00–U+9FFF | 20,976 / 20,992 | 0 / 20,992 | 20,992 / 20,992 |
| ASCII 可打印字符 | 95 / 95 | 95 / 95 | 95 / 95 |
| 中文标点 / 全角 ASCII（含全角空格） | 35 / 35；95 / 95 | 非该用途 | 35 / 35；95 / 95 |
| 大小写拼音 NFC 所需码点 | 80 / 81 | 80 / 81 | 81 / 81 |
| 同一拼音集合 NFD 所需码点 | 20 / 20 | 20 / 20 | 20 / 20 |

GB2312 是广泛、可复现的汉字集合，不能宣称等于所有小学教材用字集。两份 MiSans 缺 `U+01F8 Ǹ`；MiSans 另缺基本区末尾 `U+9FF0–U+9FFF`。三份字体的六种组合标记（四声、分音符、扬抑符）均存在且 advance 为 0，不代表简单累加宽度便可正确定位调号。

MiSans 不含 cmap 14 变体序列；LXGW 只有 `FE00/FE01` 各 12 条，不能据此忽略任意变体选择符、ZWJ 或 emoji。LXGW 有 `U+20BB7 𠮷`，MiSans 没有。不得删除变体选择符后冒充完整呈现。

可选 HarfBuzz 探针（须已安装 `hb-shape`，不是产品依赖）：

```sh
python3 assets/fonts/tools/shaping_probe.py --report assets/fonts/verification/shaping-probe.json
```

[HarfBuzz 14.6.0 报告](verification/shaping-probe.json) 枚举大小写 `a/e/i/o/u/ü/ê/m/n` 与四声/无声调的 90 个组合，比较 NFC/NFD 字形编号、位移及 advance，并检查 `.notdef`。这只是本机 shaping 证据，不等于字形边界、共享 TS 或微信验收。

## T04 / T10 交接

1. T04 从上述原始文件及散列开始，提取 `hmtx` advance、`glyf` 轮廓边界、组合字形偏移及 GPOS/GSUB 所需效果；三份 UPEM 均为 1000。报告的 ascent/descent、x-height/cap-height 不是实际墨迹范围。fontTools `TTFont.getGlyphSet()` + `BoundsPen` 可离线取边界。
2. 本机有 fontTools 4.60.1、HarfBuzz 14.6.0；检查时 Node `fontkit`、`@pdf-lib/fontkit`、`pdfkit` 未安装。fontTools 不是 shaping 引擎。产品须使用两端一致的版本数据或共享算法，不能让 Canvas/PDF 各自测宽/折行。
3. `Ǹ` 经 HarfBuzz 使用 `N` 与组合重音字形，无需改写输入或字体。T04 须验证最终实现的规范等价处理并保留原始 grapheme 映射；该路径未验证前明确拒绝不支持的簇。其他缺字同样显式报错并保留输入，不丢字、改写或回退系统字体。
4. 描红按 D-031 分配具体字体，仍复用普通填字的逻辑占位和分页。T10 验证轮廓、儿童练字笔形、声调/基线、字号/灰度与实体打印。资源准备、许可解释、运行时实现和最终验收分别记录，不因工具完成就关闭 O-004。
