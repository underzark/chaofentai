# GIF 动画页与 Agent 入口

进入 `/gif`；原图片超分页 `/` 保持 GPT Image 2.5 + Terra 流程不变。无参考图时 GIF 直接调用 OpenAI `POST /v1/images/generations`；选择静态参考图时调用 `POST /v1/images/edits`，不经过 Terra，模型单独选择 `gpt-image-2.6-sunburst` 或 `gpt-image-2.6-flare`。

## 参数（2026-11-10 核对官方文档）

- `prompt`：主体、动作、首尾衔接。本网站最多 4000 字符。
- `frame_count`：2–16，默认 9。
- `frame_duration_ms`：20–2000，默认 200，按 10 ms 四舍五入。播放 FPS = 1000 / 每帧毫秒；每轮时长 = 帧数 × 每帧毫秒。播放速度不等于生成速度。
- `size`：`auto`，或宽高为正的 16 倍数。本网站额外设每边 8192、单帧 20MP 的读取保护，不代表 API 支持这些组合。API 的总像素预算未公布，帧数 × 每帧尺寸 × 数量过大会被拒绝。
- `quality`：auto / low / medium / high / xhigh / max。
- `n`：1–10 个动画，默认 1。建议初次保持 1。
- `background`：auto / opaque。不提供未确认支持的透明 GIF。
- `moderation`：auto / low，仍遵循服务内容政策。

支持静态参考图生成 GIF；不把动画 GIF 当作输入。不支持 mask、streaming、partial images、custom output_compression、prompt_rewriter。没有独立循环次数、运动强度或 seed 参数。循环效果写入 prompt。

依据：[官方 GIF 指南](https://developers.openai.com/api/docs/guides/image-generation#generate-animated-gif-output)、[Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)。当前官方 GIF 指南与 API reference 均明确帧数上限为 16；不能再按旧版 64 帧设置。不同部署的模型账号权限和托管长请求仍需独立验收。

## 费用与执行

网页点击生成只准备确认单，不调用付费 API。确认单绑定所有参数及费用说明；取消、Esc、改参数不会生成。确认后仅提交一次，重放同一确认不会重发 API。Agent 与网页确认单相互隔离。

GIF 暂无可靠单张费用预估，本实现记录 API usage、request ID，金额保持未知，不套用静态 PNG 价格，不声称最终账单或美元硬封顶。本网站只接收 16 MiB 编码响应（约 12 MiB GIF 总量），超出有可能无法取回已付费的结果；确认前明确披露，建议先用少帧、小尺寸、单个动画。

直接 Images API 不提供可检索的后台 response ID。页面需保持打开。连接/超时结果不明时只查询原订单，不自动重试、不换 key。响应先保存私有检查点，再按原字节保存 GIF；本地存储错误可从检查点恢复而不再调用生成。若原响应没有存下来，不承诺能找回。

## Work / Agent

1. `canvas_gif_options` 查看 GIF 是否启用、参数和成本说明。
2. 有参考图时先通过现有 `canvas_import_file` 导入用户选定的 PNG/JPEG，再向 `canvas_prepare_gif` 传有序 `reference_asset_ids` 及完整意图和参数，免费准备；无参考图时省略该字段。
3. 向用户展示返回的完整 summary，包括每张参考图、SHA256、将参考图发给 OpenAI 的说明，说明 USD 费用未知，等待该单真实确认。不能把 @、上传、旧的超分授权或 Agent 自己写的文字作为同意。
4. `canvas_confirm_gif` 原样传 approval_id、quote_hash、confirmation_text，user_confirmation 记录用户实际回复。参数变更重新 prepare。
5. `canvas_get_gif` 用原 idempotency_key 查询；`canvas_gif_history` 查看相同网页历史。
6. 每个 output 都是原 GIF。≤1MiB 用 canvas_read_file；更大用 canvas_read_file_chunk，length=4194304，失败同 offset 退至 262144。校验每块及整体 SHA，使用当前官方文件通道原生附上 `.gif`，不能改成 PNG 或截图，并说明费用未知。

## 配置与迁移

新增 `GIF_ENABLED=false` 默认关闭；启用需要现有 `LIVE_ENABLED=true`、同一 `MANUAL_TRIAL_OWNER`、现有 API secret。Work 还需要 `WORK_ENABLED=true`。不改变 owner、secret、旧生成权限、D1/R2 绑定和分享范围。

新增 `0010_gif.sql` 为独立 quotes、jobs、outputs 表及 GIF 媒体保护触发器。新部署使用公共仓库完整 journal。升级既有站点时保留其全部历史 migration/journal，只追加新 entry，不重排或补写生产旧 entry。

GIF 独立显示最近 50 条记录，文件暂不自动淘汰；原超分的历史淘汰不能删除 GIF 引用的媒体。存储会持续增长，页面明确告知。检查点与数据库开销不计入媒体统计。没有自动清理生产数据。

未知提交会阻挡新 GIF 单。只有部署者核对账单和请求后才可通过 `GIF_ACK_UNKNOWN_IDS` 显式承认旧未知记录；此设置不重试或删除旧单，不得自动填充。

## 免费验证

`npm test` 包含 GIF 参数/确认/幂等/恢复/MIME/字节/权限回归。`npm run build && npm run validate` 验证打包。可选 Playwright UI：`node scripts/test-gif-ui.mjs`，只用合成路由，所有外部请求均拒绝。测试不读取真实凭据、不调用真实生成、不触碰远程数据库。

## Worker transport compatibility

GIF requests use `redirect: manual` and explicitly reject every 3xx response without following `Location` or forwarding credentials. The deployed Worker runtime does not support `redirect: error`.

Each new order records redacted transport stage/outcome, HTTP status, request ID, and exact allowlisted error code, parameter name, and error type. Error messages, invalid parameter values, unexpected names/types and other payload fields are not retained. An unrecognized identifier is recorded only as `unrecognized_redacted`. A known parameter name is also shown in the ordinary page/Agent error message. A parameter such as `size` identifies the rejected field, not the exact constraint; no undocumented pixel budget is inferred. Old errors that did not record these fields cannot be reconstructed from the application. A failure proven to occur before fetch is invoked is `submission_not_sent`; once fetch is invoked, exceptions remain conservatively `submission_unknown`. This fix does not rewrite or resubmit older unknown orders. The web page mirrors status/error beside the generate button and queries the original order while the first POST is pending. Those queries never call generation.

## Sliders and exact values

The web page provides paired sliders and numeric inputs for 2–16 frames, 1–10 animations, and custom width/height in 16px increments. The speed slider moves from slow (2000ms per frame, 0.5 FPS) on the left to fast (20ms, 50 FPS) on the right. It covers every 10ms interval; the numeric millisecond input and speed presets stay synchronized. The actual FPS is derived from the rounded interval, so not every arbitrary FPS value is exactly representable.

Quality remains a discrete choice: auto, low, medium, high, xhigh, max. Model, automatic/preset/custom size, background and moderation remain labeled selectors. In automatic or preset size mode, hidden custom dimensions are disabled so an unfinished custom input cannot block submission. Controls retain native keyboard operation and 44px-high touch areas. All existing per-order confirmations, unknown-order protection and read-only polling remain unchanged.

## 2026-11-05 帧数修复

当前官方指南和 API reference 均为 2–16 帧（默认 9）。超过当前 16 帧上限的设置会被拒绝。网页滑块、精确输入、Agent schema、prepare 和首次 submit 使用相同上限。未执行的旧版超限确认单也在 claim 和付费请求前拒绝，不替用户改成 16 帧；已执行订单优先返回历史，不重发。历史文件的读取保护保持不变。

建议先用 9 帧、200ms、自动尺寸、单个动画；Low 适合先看效果。15 或 16 帧也在范围内，无需因帧数错误把画质强制改低。更长一轮通过增加每帧时长实现，但这不会增加动作采样数。尺寸/数量仍受未公布的 GIF 总像素预算约束，不能承诺所有其他组合都不报错。


## 2026-11-10 参考图上传

- 可选 1–16 张静态 PNG/JPEG，保持选择顺序；不选图片仍走原文生 GIF。
- 本站保护限制：每张 8 MiB、原图总量及校正后总量各不超过 16 MiB，沿用原上传服务的格式、像素和 JPEG 朝向/尾部校验。官方接口也支持 WebP 与更大文件，但本站尚未开放 WebP；这些小限额是本站限制而非 API 限制。
- 选择文件只在浏览器本地预览。点击“核对并生成”会先免费上传到本人私有存储；返回修改、Escape 或上传失败均不调用生成 API。移除选择不等于删除已上传的私有文件。
- 确认单绑定有序原图 ID、SHA256、尺寸、大小、格式和需要时的校正副本；确认前展示参考缩略图并告知文字、参考图将发给 OpenAI。参数或选图发生变更必须重新准备确认单。
- 确认后以 multipart `image[]` 调用 `/v1/images/edits`，由运行时生成 boundary，不传本地文件名、私有资产 ID、URL 或内部元数据。原图和校正副本均在付费调用前做长度和 SHA256 校验。缺失、篡改、跨 owner、非静态或超限输入会在请求前拒绝。
- 参考图扩展不增加 GIF 基础迁移之外的新迁移，不改 secret/额度/开关，也不重放未知单。已有 GIF 订单引用的参考图和有效确认单的参考图受超分历史清理保护；未使用上传暂不自动清理。
- 该模型/项目仍需 GIF preview 权限。免费回归不能证明真实 API 额度、权限、付费耗时或效果；维护者已在独立私有部署验收静态参考图生成 GIF；这不替代其他部署的权限、参数组合或并发验收。保留旧文生 GIF、结果保存与查询路径。
- 免费覆盖：`node scripts/test-gif-references.mjs`、现有完整 `npm test`、构建与产物校验。官方依据：[Images edits](https://developers.openai.com/api/reference/resources/images/methods/edit)、[GIF 指南](https://developers.openai.com/api/docs/guides/image-generation#generate-animated-gif-output)。
