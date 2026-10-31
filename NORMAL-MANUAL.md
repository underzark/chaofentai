# 日常逐单模式
按 AGENT-DEPLOY.md 在自己的私有副本启用 MANUAL_MODE=per_order。它没有终身一张限制，但每单仍需绑定原图、参数、报价后明确确认。10 分钟报价过期或参数改变须重新确认。一次授权原子消费一次，单 owner 只允许一个在途/未知任务。取消不生成，未知提交不重试。
Work 的 prepare/confirm 走独立授权，不能继承网页点击或只传 approved:true。旧提交入口在正常模式下保持关闭。
格式限制、资源边界和保存兜底见 README.md；测试见 TESTING.md。不开启任何开关也可运行无费用回归。
