# 烘焙试配稳定性与风味标注范围

豆批和成品重量用千克，分数越高代表相应风味越强。物料的 source_origin 表示需要实证对应的原料来源。 所有资料均为合成记录。文件编码为 UTF-8，数字、日期及标记在原始记录中均以字符串保存。问号表示来源未能提供该值；加号分隔来源系统使用的组合编号。

## 资料

green 的 stock 为开始投料前的实有重量，母批重量包含已经拆分的子批数量。label 的 range_max 应用于档案允许重复条件下每项风味的分数跨度，min_days 是独立试烘日数。已发包装凭据是外部交付事实，待发包装仍在本厂。

- `green.json` 记录字段为 `lot`、`origin`、`grade`、`stock`、`split_parent`。
- `roasts.json` 记录字段为 `test`、`lot_a`、`lot_b`、`ratio_a`、`profile`、`day`、`blind`。
- `cups.json` 记录字段为 `blind`、`judge`、`rep`、`fruit`、`bitter`、`version`、`state`。
- `labels.json` 记录字段为 `label`、`fruit_min`、`bitter_max`、`range_max`、`min_days`。
- `work.json` 记录字段为 `order`、`lot_a`、`lot_b`、`ratio_a`、`weight`、`label`、`state`、`finished`。
- `splits.json` 记录字段为 `parent`、`child`、`kg`、`state`。
- `shipments.json` 记录字段为 `finished`、`package`、`weight`、`label`、`state`。

## 运行

使用 Node.js 22。项目无需下载第三方依赖。

```sh
npm ci --offline --ignore-scripts
npm test
```

`npm run data:check` 检查合成资料能否读取并核对相关记录的引用。资料校验脚本可以独立运行。
