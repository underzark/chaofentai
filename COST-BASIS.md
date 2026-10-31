# 单次费用口径

以 Responses usage 计算协调模型，以 tool_usage.image_gen 计算图像工具，二者分列后相加，不重复累计。保存实际模型、service_tier、raw usage、响应状态、图像调用数、response ID、价格版本与来源。billed_usd 始终为 null；展示用量估算，不是已核实实付、银行卡扣款或余额。赠送额度仍消耗API用量。

当前代码价格快照为 official-standard-2026-10-30-default-30m，官方来源 https://developers.openai.com/api/docs/pricing 。Terra标准每百万token：输入1美元、缓存读取0.05美元、默认30分钟写入1.25美元、输出5美元。图像工具图片输入8/缓存2，文本输入5/缓存1.25，图片输出30。部署或费率变更前须重新核实，不把快照当永久价格。

协调模型缓存细分缺失时，按该模型已验证的缓存/普通/写入费率取保守最小最大值；例如Terra 1000输入token范围0.00005–0.00125美元。仍标总额unknown和main_cache_breakdown，已知部分不是完整账单上下限。未知tier不套默认费率，不显示未验证的金额部分。未知模型不编造模型费。

图像缓存省略表示未知，可以在用量完整时按缓存至非缓存给区间；图像总用量不完整、零输出异常、多次调用、未完成响应或缺少历史完成证据时不得假装完整总计。重算保守保留所有missing标记。运行中显示待计算。

没有逐请求最终账单cost字段。Costs API是日聚合，不适合本单精确对账，公开文档未保证更新延迟；不要为了本单金额增加管理员凭据或自动账务查询。

## Independent deployment
Deploy a new owner-private Site with your own API secret. Set STUDIO_SUBTITLE to the agent name, then user name; ask if both are unknown. Default LIVE/POLL stays false. For reviewed ordinary browser use, follow NORMAL-MANUAL.md and obtain owner activation; every order still needs explicit confirmation. MANUAL-TRIAL.md is optional one-shot testing only. No automatic agent spending. Unknown usage or tier means unknown cost. Return one uncropped original PNG plus usage-derived cost.
