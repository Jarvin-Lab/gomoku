# 专家 AI 失败棋谱库

玩家执黑击败“专家”AI 后，对局会自动转换为 `expert-loss-fixture`，保存在浏览器
`localStorage`，下载按钮导出的文件名为 `<分类>--<fixture-id>.json`。把文件放进同名分类目录，
运行 `node tests/run-all.mjs` 即可纳入后续升级的回归锚点。

五类目录：

- `pattern-misread`：误判棋型
- `missed-double-kill`：漏防双杀
- `missed-vcf`：漏算 VCF
- `defense-order`：防守次序错误
- `opening-disadvantage`：开局劣势

新收录样本使用 `status: "known-failure"`，并同步登记到
`known-failures-baseline.json`。修复后改为 `status: "resolved"`。

Schema v2 将最终败着保留在 `failure`，将更早的策略根因记录在 `rootCause`，并通过
`tags` 同时标记双杀、VCF、防守次序和搜索超时等因素。回归默认从根因局面启动。

`expectation` 除了可选的 `acceptableMoves` 和必须保留的 `avoidMoves`，还使用
`invariants` 验证以下性质：

- 防后对手直接胜点不超过限制
- 防后不存在双杀入口
- 限定深度内不存在对手强制胜
- 专家决策不超过时间预算

这样测试约束的是棋力和安全性质，不会因为锁死唯一坐标阻碍后续搜索升级。
