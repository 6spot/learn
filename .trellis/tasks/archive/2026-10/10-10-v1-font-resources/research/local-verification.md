# T02 本地实施证据 — 2026-10-10

## 实际完成

- 三个字体、两个许可证、两个 ZIP 的原始大小与 SHA-256 重新核对，两个 ZIP 全包 CRC 通过。原始来源与散列只在 [manifest](../../../../../../assets/fonts/manifest.json) 维护。
- 新增恢复工具：默认离线；显式 `--download` 只补缺失文件；校验临时文件后原子写入，既有文件不覆盖；上游版本变化明确失败。对真实原始 ZIP 在临时资源根目录执行离线提取恢复，再验全部资源，通过；没有重新联网下载，也不改原始字体。
- Python 标准库工具测试 **13/13 通过**：缺失/损坏文件、禁止默认联网、错误/中断下载、原子写入竞态、ZIP 指定成员/路径、散列绑定、明确覆盖失败，以及完整合成字符集。
- `fonttools==4.60.1` 实际读取三份字体的表目录、版本、cmap、advance/纵向度量；确定性报告位于 [coverage.json](../../../../../../assets/fonts/verification/coverage.json)。严格 `verify` 返回 1，正确保留两份 MiSans 缺 `U+01F8` 的覆盖失败；`--allow-coverage-gaps` 返回 0 且明确输出“gaps recorded (not passed)”。
- 完整 GB2312 汉字两份中文字体均覆盖 6,763 / 6,763。额外基本 CJK 检查发现 MiSans 缺 `U+9FF0–U+9FFF`；NFC 拼音集合两份 MiSans 80 / 81，NFD 全部 20 / 20，组合标记 advance 均为 0。详见资源说明，不把 GB2312 当作所有小学教材用字集。
- 可选本机 **HarfBuzz 14.6.0** 对每份字体各 90 个拼音簇的 NFC/NFD 形式检查：字形编号、偏移/advance 相同且无 `.notdef`，**270 / 270 簇通过**。它能将 `Ǹ` 规范分解为基础字母与组合重音；[探针报告](../../../../../../assets/fonts/verification/shaping-probe.json) 不代表最终 TS/Canvas/PDF 路径已完成。
- 重新从本地 MiSans 协议 PDF 提取并读取条款，逐用途核对 [许可研究](../../../../../../assets/fonts/licenses/review.md)。OFL 明文允许的方式与 MiSans 尚待解释的具体交付方式分别记录；不以 fsType 替代授权。

## 重跑

```sh
python3 -m unittest discover -s assets/fonts/tools -p 'test_*.py'
python3 assets/fonts/tools/font_resources.py verify --hashes-only --archives
assets/fonts/.venv/bin/python assets/fonts/tools/font_resources.py verify --archives --allow-coverage-gaps --report assets/fonts/verification/coverage.json
python3 assets/fonts/tools/shaping_probe.py --report assets/fonts/verification/shaping-probe.json
```

`.venv` 安装步骤及新 checkout 恢复见 [README](../../../../../../assets/fonts/README.md)。工具不要求用户上传字体；上游发生变化时保留原始 pin，先核对版本。

## 下游与最终门槛

T04 可直接使用原始 TTF、散列与真实元数据；建议由浏览器兼容 shaping provider 输出固定 font-unit 字形/advance/偏移/墨迹边界，经统一缩放进入布局，两端同源且验证同一结果。FontTools 只是离线元数据/轮廓工具，不能替代 GSUB/GPOS shaping。字形输出为 `.notdef`、不支持的 IVS/ZWJ/emoji 须明确失败并保留输入，不能由 Canvas/PDF 自行换字体。

MiSans 具体分发/子集许可、产品署名、最终字体资源体积、共享 JS 实现、微信实际加载、字形人工检查和实体打印均未验收；依用户授权，组件配置/真机/打印留最终 Owner 清单，不阻塞独立本地实现。本轮不改核心、预设、UI 或云端，不运行无关核心测试，不提交字体二进制，不提交/归档任务。
