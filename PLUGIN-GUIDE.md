# 超分台插件说明

实际 MCP initialize.instructions、canvas_status.work_instructions 与 tool descriptions 共同执行 WORK-GUIDE.md 的流程：读取原文件实际尺寸 → 权威倍率规划 → 增强/保留/尺寸/模型/费用确认单 → 真实用户同意 → 精确报价提交 → 同key轮询 → 完整PNG与费用。

默认Terra＋Sunburst；只有用户明确要快速才用Flare。不能自动使用suggested_plan替换不可用2倍。旧canvas_submit_background在per_order下禁止使用。服务端绑定owner、原图SHA、参数与费用版本；agent仍必须真实展示并取得本单同意，user_confirmation不是人类签名证明。

朋友各自私有部署与API，默认不开启；当前实际能力以canvas_status为准。说明更新不改变生成、授权、幂等、费用、保留或文件字节。


## 原文件搬运（v34）
文件不超过 1 MiB 时调用 `canvas_read_file` 一次；更大文件调用 `canvas_read_file_chunk`，显式设置 `length:4194304`，按 `next_offset` 顺序读取。省略 length 仍是兼容用的 256 KiB。真实 Work 已用 3 次读取验证约 11 MiB 合成文件完整性，不承诺所有图片少于 5 次或固定耗时。
工具失败时保留相同 offset，改用 `length:262144` 重试读取；不重新生成、不更换生图幂等键。嵌入的 `resource.blob` 必须在执行器代码内解码拼接，不写进模型文本或日志。逐块核验 chunk_sha256，完成后核验原文件 SHA256/长度，再通过受支持 Library 通道发送一张原 PNG 和本次用量估算。鉴权失败先处理连接，禁止公开文件或绕过 owner 校验。

## Independent deployment
Deploy a new owner-private Site with your own API secret. Set STUDIO_SUBTITLE to the agent name, then user name; ask if both are unknown. Default LIVE/POLL stays false. For reviewed ordinary browser use, follow NORMAL-MANUAL.md and obtain owner activation; every order still needs explicit confirmation. MANUAL-TRIAL.md is optional one-shot testing only. No automatic agent spending. Unknown usage or tier means unknown cost. Return one uncropped original PNG plus usage-derived cost.
