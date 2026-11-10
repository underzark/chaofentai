# 超分台 Work 操作规范

## 先读取与规划，不直接生成
选定用户明确指定的原文件：可以是 Work 刚生成的图，也可以是现成图。不可换成预览截图；用户自己选截图则如实按截图处理。agent 从文件/导入返回值读取实际宽高与 SHA，不向用户询问本可读取的尺寸。

1. `canvas_status` 核对 `work_orders.enabled`。关闭就明确说明，不尝试旧入口。
2. `canvas_import_file` 导入原PNG/JPG。以真实 `width/height` 调用 `canvas_status({plan:{width,height,scale:2,image_model:"gpt-image-2.5-sunburst",main_model:"gpt-6.1-terra"}})`；用户已指定倍率则代入。
3. 使用工具返回的 `scale_bounds`、`max_plan` 和实际输出尺寸，不能自行猜最大倍率。默认2倍不可用时，展示合法范围、上限及对应尺寸，请用户选择；`suggested_plan` 只是供选择，不是已获授权的自动替代。无合法倍率就如实说明。
4. 默认高质量 **Sunburst**；只有用户明确要快速才用 **Flare**。主协调模型固定 **GPT-6.1 Terra**。不要只为速度自行换模型。
5. 结合图像提出增强区域/细节与严格保留项；用户已经说清的内容直接带入。没有明确方案时给少量具体选项，不调用额外分析API。

## 简短确认单
用 `canvas_prepare_order` 免费取得绑定报价，再展示下列汇总，邀请用户选择、修改并确认本单。已明确的内容只汇总，不重复盘问。

> 原文件：〔名称〕，实际〔宽×高〕。最大可用〔倍率〕→〔尺寸〕。
> 本单：〔倍率〕→〔实际输出尺寸〕，Terra＋Sunburst，1张。
> 增强：〔区域与内容〕。严格保留：〔身份/姿势/构图/色调等〕。
> 费用：〔工具支持的估算及依据；未知则如实注明〕，不是最终实扣或硬封顶。
> 这样处理可以吗？也可以先修改方案。

不要主动提出裁边。模型尺寸对齐多出的少量像素保留，最终交付完整原PNG。

## 确认后执行与交付
取得本单真实用户同意后，`canvas_confirm_order` 原样传 `approval_id/quote_hash/confirmation_text`，`user_confirmation` 记录实际同意原话。不能代写同意、用@或上传代替同意、用空泛approved放行，也不能复用网页授权。任何参数变化都重新报价确认。

只提交一次，保存原idempotency_key；`canvas_poll_background` 查询同key。unknown不换key、不重POST。完成后取回一个完整原PNG，核验SHA和实际尺寸，经当前官方Library通道原生发送，同时报告本次USD用量估算及主模型/图像分项。缺字段写未知，不写假零，不称最终账单或银行卡实扣。

## 文件与使用边界
历史最多最近50条，每页10条；启用保留规则后，未来新任务超限会移除最早可淘汰记录及不再共享的文件。在途/unknown和共享引用受保护。不要每单冗长重复规则，需要时提醒下载保存重要图。默认对比，缺原图时显示结果。

上传最大8MiB。正向基线单扫描JPEG可原字节直传，最大20MP/边8192；旋转或渐进JPEG仍受2MP解码预算限制，复杂文件可能被拒绝。不能偷偷缩图或改后缀。iPhone保存依系统分享/下载能力，不能承诺直接写入相册。

朋友须部署自己的owner-private副本，使用自己的API。模板默认开关关闭，部署者自己授权启用。不会复制本站身份、任务或凭据。用户已报告本人的Work全流程成功；本次仅说明更新，没有新付费验收。


## 原文件搬运（v34）
文件不超过 1 MiB 时调用 `canvas_read_file` 一次；更大文件调用 `canvas_read_file_chunk`，显式设置 `length:4194304`，按 `next_offset` 顺序读取。省略 length 仍是兼容用的 256 KiB。真实 Work 已用 3 次读取验证约 11 MiB 合成文件完整性，不承诺所有图片少于 5 次或固定耗时。
工具失败时保留相同 offset，改用 `length:262144` 重试读取；不重新生成、不更换生图幂等键。嵌入的 `resource.blob` 必须在执行器代码内解码拼接，不写进模型文本或日志。逐块核验 chunk_sha256，完成后核验原文件 SHA256/长度，再通过受支持 Library 通道发送一张原 PNG 和本次用量估算。鉴权失败先处理连接，禁止公开文件或绕过 owner 校验。


## JPEG 尾部兼容（v35）
按 JPEG marker/扫描结构定位真正结束标记，不按文件末尾或字节搜索猜测。最多接受32字节受限二进制尾部，拒绝明显拼接媒体、文档、脚本/文本及后置EXIF/ICC。原件保持原字节和SHA，模型使用去尾副本；ICC和JPEG压缩数据保留，不重新有损编码。普通大图仍采用有界结构验证，不为兼容尾部强制全图解码；这不是任意损坏图片修复器。上传响应 normalization.trailer_bytes_removed 明示去尾字节数。


## 网页保存入口（v36）
结果只保留一个“保存到本地”原文件链接。桌面普通点击使用浏览器原生下载，链接仍支持右键“链接另存为”；触控环境支持时可准备并交给系统分享。页面不会把脚本点击当成保存成功。若宿主内嵌页限制下载，保留右键／长按真实链接的途径，不公开文件或绕过宿主权限。

## Independent deployment
Deploy a new owner-private Site with your own API secret. Set STUDIO_SUBTITLE to the agent name, then user name; ask if both are unknown. Default LIVE/POLL stays false. For reviewed ordinary browser use, follow NORMAL-MANUAL.md and obtain owner activation; every order still needs explicit confirmation. MANUAL-TRIAL.md is optional one-shot testing only. No automatic agent spending. Unknown usage or tier means unknown cost. Return one uncropped original PNG plus usage-derived cost.


## GIF 动画

网页 `/gif` 与 Work 共用逐单确认后端。使用 `canvas_gif_options`、`canvas_prepare_gif`、`canvas_confirm_gif`、`canvas_get_gif`、`canvas_gif_history`；交付原 GIF，不走 PNG 超分流程。完整参数、限制、费用与免费测试见 [GIF-GUIDE.md](GIF-GUIDE.md)。
