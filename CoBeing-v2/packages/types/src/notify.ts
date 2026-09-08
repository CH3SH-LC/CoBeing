/**
 * 用户通知载荷（内核 → GUI/手机端 通知面；客户端按 type 分派）
 *
 * - type='text'：普通通知（任务栏闪烁 + 一声滴场景）
 * - type='confirm'：管家 ask-user 工具发起的确认请求——GUI 渲染确认卡片
 *   （question + 可点击选项按钮），用户点击后经主对话 mainWindowSpeak 回传
 *   「【确认答复】<label>」，管家在下一轮组装中看到选择并执行。
 *   若携带 approval 字段，则该卡为「待批准创建智能体」（管家 create-agent 工具发起）：
 *   options 固定 [批准/拒绝]，GUI 点击直接调 confirmAgent / rejectAgentApproval，
 *   不回传文本给管家（2.0.13：管家创建智能体批准卡弹主对话，不再只埋智能体页）。
 * - type='update'：数据变更信号（实时同步协议）——内核关键变更点（新消息落盘、
 *   回复完成、群组/智能体增删改）广播，客户端收到后立即刷新对应数据，
 *   不依赖轮询。scope 指明变更域，客户端按需刷新（含未挂载视图的挂起标记）。
 * - type='pair'：配对事件（2.0.4 自动配对）——手机经局域网发现电脑并完成
 *   pair/request 密钥交换后广播；GUI/其他设备可见「XX 已配对」。
 * - type='tunnel'：cloudflared 隧道事件——配对成功后自动启动隧道，URL 就绪时
 *   广播 update（携带 url）；手机端收到后自动更新配置并切换公网连接。
 */

export interface ConfirmOption {
  /** 选项稳定 id（如 'reuse' / 'create'） */
  id: string
  /** 用户可见的选项标签 */
  label: string
}

/** 数据变更域：butler=主窗口会话；group=指定群组；groups=群组列表；agents=智能体名录/批准队列 */
export type UpdateScope = 'butler' | 'group' | 'groups' | 'agents'

export type NotifyPayload =
  | { type: 'text'; content: string }
  | { type: 'confirm'; id: string; question: string; options: ConfirmOption[]; approval?: { name: string; role: string } }
  | { type: 'update'; scope: UpdateScope; group?: string; kind?: string }
  | { type: 'pair'; action: 'paired' | 'revoked'; deviceName: string }
  | { type: 'tunnel'; action: 'update' | 'started' | 'stopped' | 'error'; url?: string; message?: string }
