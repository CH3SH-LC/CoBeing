### 🌐 服务地址 (Base URL)

Moonshot AI（月之暗面）提供全球和中国大陆两套不同的 API 接入点，请根据你的网络环境和账户类型选择相应的 Base URL：

| 服务地域 | Base URL (Base URL) | 说明 |
| :--- | :--- | :--- |
| **🌍 全球** | `https://api.moonshot.ai/v1` | 国际用户，或通过某些代理服务访问时使用 |
| **🇨🇳 中国大陆** | `https://api.moonshot.cn/v1` | 中国大陆账户的标准接入点 |

### 🤖 可用模型

Moonshot AI 提供多个版本的模型，覆盖不同的上下文长度、推理能力和多模态需求。主要模型列表如下：

| 模型系列 | 模型ID | 核心特点 | 上下文窗口 |
| :--- | :--- | :--- | :--- |
| **Kimi K2.6 (最新旗舰)** | `kimi-k2.6` | 最新最智能的模型，代码写作、指令遵循和自修正能力显著提升；支持多模态输入。 | 262K+ |
| **Kimi K2.5 (高智能模型)** | `kimi-k2.5` | 官方宣称最智能的模型，在Agent、代码、视觉和多模态理解上表现优异。 | 128K+ |
| **Kimi K2 (基础模型)** | `kimi-k2` 或 `kimi-k2-0905-preview` | 强大的MoE架构模型，擅长智能体任务、编程与推理。 | 128K |
| **Kimi 思考链模型 (Kimi K2系列)** | `kimi-k2-thinking` | 在输出最终答案前进行内部思考，以增强推理准确性。 | - |
| **通用长文本模型系列 (文本)** | `moonshot-v1-128k` / `moonshot-v1-32k` / `moonshot-v1-8k` | 分别面向超长文本、长文本和短文本生成任务，适合不同应用场景。 | 128K / 32K / 8K |
| **视觉理解模型 (多模态)** | `moonshot-v1-vision-preview` 或 `moonshot-v1-8k-vision-preview` | 支持图像识别、OCR文字识别和图像数据提取等任务。 | - |

### 🛡️ 预备工作：获取 API Key 与分组ID

1.  **注册并登录**：访问 [Moonshot AI 开放平台](https://platform.moonshot.cn/)，完成账号注册或登录。
2.  **创建 API Key**：在平台控制台的 **API Keys** 页面，点击 **创建API Key**。给密钥起一个描述性名称（例如“本地开发”）。
3.  **保存 API Key**：系统将生成唯一的API Key。**请务必立即复制并妥善保存**，之后将无法再次查看。
4.  **账户充值（如需要）**：部分模型的使用需要账户有余额。访问控制台的支付页面进行充值，最低可充值$1进行测试。

### 💻 调用方式

#### Python (openai SDK) - 推荐

Moonshot AI 的 API 与 OpenAI 的接口完全兼容，因此可以使用 `openai` Python 库轻松接入。

```python
# 1. 安装依赖：pip install -U openai

from openai import OpenAI
import os

# 初始化客户端，配置API密钥和Base URL
client = OpenAI(
    api_key = os.environ.get("MOONSHOT_API_KEY"),  # 替换为你的 API Key
    base_url = "https://api.moonshot.cn/v1",      # 中国大陆 Base URL
)

# 发起对话
response = client.chat.completions.create(
    model = "kimi-k2.5",                         # 或 "moonshot-v1-128k", "moonshot-v1-vision-preview"
    messages = [
        {"role": "system", "content": "你是一个乐于助人的助手。"},
        {"role": "user", "content": "请介绍一下 K2.5 模型的特点"}
    ],
    max_tokens = 1024,
    temperature = 0.7
)

print(response.choices[0].message.content)
```
> 以上代码示例同时参考了阿里云社区的开发者指南和通用最佳实践。

#### cURL (HTTP API)

如果需要不依赖SDK直接调用，可以使用 `curl` 命令：

```bash
# 中国大陆
curl -X POST "https://api.moonshot.cn/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "kimi-k2.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

> **返回值说明**：接口会返回一个JSON对象，其中 `choices[0].message.content` 字段包含了模型的回答。对于支持思考链的模型（如`kimi-k2-thinking`），响应中可能额外包含`reasoning_content`字段，记录模型的推理过程。

### 💡 最佳实践与注意事项

1.  **🔐 API Key 安全**：强烈建议通过环境变量 `MOONSHOT_API_KEY` 来存储API Key，避免硬编码到代码中。
2.  **📡 流式输出**：将 `stream` 参数设为 `true` 可以获得逐字的流式输出，提升用户体验。在SDK中，调用时传递 `stream=True` 即可。
3.  **⚙️ 参数调优**：合理使用 `temperature` (0~2之间)、`top_p` 和 `max_tokens` 等参数来控制输出的随机性与长度。
4.  **🌐 端点选择**：调用 API 时，Base URL 应根据你的网络环境是选择全球 `.ai` 还是中国 `.cn` 端点。
5.  **📄 多模态调用**：调用视觉模型 `moonshot-v1-vision-preview` 时，`messages` 中的 `content` 字段需要从字符串（str）改为列表（list），以包含图片URL和文字部分。
6.  **🚀 更多工具集成**：Moonshot AI 的 API 也支持通过 LangChain、LiteLLM 等标准框架进行集成，可查阅相应文档获得示例。
7.  **💰 计费与免费额度**：Kimi K2.6 的输入约为 $0.76/M tokens，输出约为 $3.20/M tokens；Kimi K2.5 约 $0.48/M 输入，$2.4/M 输出。免费额度方面，对于 `moonshot-v1` 系列，通常设有每分钟3次请求和32，000 token的免费额度。价格可能会有变动，建议查询官方最新的定价信息。

### 🔗 官方资源链接

*   **开放平台首页**：[https://platform.moonshot.cn/](https://platform.moonshot.cn/)
*   **API Key 管理**：[https://platform.moonshot.cn/console/api-keys](https://platform.moonshot.cn/console/api-keys)
*   **完整模型列表**：[https://platform.kimi.ai/docs/models](https://platform.kimi.ai/docs/models)
*   **官方文档**：[https://platform.moonshot.cn/docs](https://platform.moonshot.cn/docs)