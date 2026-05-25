这份指南整合了通过 API 接入 MiniMax 大模型的核心信息，包括服务地址、模型选择、密钥申请和具体调用方法。

### 🌐 服务地址 (Base URL)
MiniMax 的 API 在与 OpenAI 等平台兼容的同时，也具备其自身的独特性。

*   **重要提示**：MiniMax 要求同时提供 API Key **和** Group ID 进行身份验证，请在后续调用中注意。同时，*国际版* 与 *中国大陆版* 的 API 域名为 **`minimax.io`** 和 **`minimaxi.com`**，请务必根据你的网络环境选择正确的入口。

| 服务地域 | 服务类型 | 对应名称 | Base URL (SDK配置) | 备注 |
| :--- | :--- | :--- | :--- | :--- |
| **中国大陆** | 对话/补全 | 对话 | `https://api.minimaxi.com/v1` | 必须携带 `Group ID` |
| **国际** | 对话/补全 | 对话 | `https://api.minimax.io/v1` | 必须携带 `Group ID` |
| **中国大陆** | 多模态 | 多模态 | `https://api.minimaxi.com/v1/multimodal` | 支持图像理解等 |
| **中国大陆** | Anthropic兼容 | 通用 | `https://api.minimaxi.com/anthropic` | 专供Anthropic兼容工具 |
| **中国大陆** | OpenAI 兼容 | 通用 | `https://api.minimaxi.com/v1` | 专供OpenAI兼容工具 |

### 🤖 核心模型
MiniMax 支持包括大语言模型（LLM）、TTS及视频生成在内的多种模型服务，如需完整列表可[参考官方文档](https://platform.minimax.io/docs/release-notes/models)。

| 模型系列 | 模型ID | 核心特点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **M2.7** | `MiniMax-M2.7`或`MiniMax-M2.7-highspeed` | MiniMax 最新推理模型，具备“递归自进化”能力 | 复杂推理任务、需要模型自我修正和优化的高级应用 |
| **M2.5** | `MiniMax-M2.5`或`MiniMax-M2.5-highspeed` | 在编程、工具调用和办公场景上达到新的SOTA水平 | 代码生成、函数调用、商业报告自动生成等 |
| **M2.1** | `MiniMax-M2.1` | 多语言编程专家，擅长精确的代码重构和多语言开发 | 跨国团队协作、多语言代码维护、自动化办公 |
| **abab6.5 系列** | `abab6.5-chat`/`abab6.5t`等，后续会更新为`M2.5` | 早期万亿美元参数的MoE模型，效果均衡 | 通用对话、内容生成、文本摘要等常规任务 |
| **Hailuo (海螺)** | `MiniMax-Hailuo-02`/ -23 | 视频生成模型，支持生成高达1080P分辨率和10秒时长的视频 | AI视频创作、动画制作、广告片生成 |
| **Music** | Music-2.6 | 音乐生成模型，支持音乐封面生成和低音重定义 | AI作曲、音乐风格转换、自动化音乐创作 |
| **Speech** | Speech-02系列等 | 超逼真语音合成模型，支持多语言，表现力强 | 虚拟助手语音、有声读物制作、高质量配音 |

### 0️⃣ 预备工作：获取API Key与Group ID

1.  **注册并认证**：访问 [MiniMax 开放平台](https://platform.minimaxi.com) 并登录。
2.  **获取 Group ID**：这是 MiniMax 特有的必需参数。登录后，在 **账户管理** 或 **基本信息** 中找到你的 **Group ID** 并记录下来。
3.  **创建 API Key**：
    *   进入“API密钥管理”页面。
    *   点击“**创建新密钥**”。
    *   填写密钥名称、选择所属地域（中国大陆请中国大陆选项）。根据需要选择 **按量付费 API Key** 或 **Token Plan Key**。
4.  **保存密钥**：平台会生成一个唯一的 API Key（通常以 `QC-` 开头）。

### 💻 调用方式

#### Python (OpenAI SDK) - 推荐
这是最通用的方式，但请注意必须同时传递 `api_key` 和 `default_headers` 中的 `Group ID`。

```python
# 1. 安装依赖：pip install -U openai
# 2. 设置环境变量：MINIMAX_API_KEY 和 MINIMAX_GROUP_ID

from openai import OpenAI
import os

client = OpenAI(
    api_key = os.getenv("MINIMAX_API_KEY"), # 你的API Key
    base_url = "https://api.minimaxi.com/v1", # 中国大陆 Base URL
    default_headers={
        "x-group-id": os.getenv("MINIMAX_GROUP_ID") # 必需：Group ID
    }
)

response = client.chat.completions.create(
    model = "MiniMax-M2.5", # 或 abab6.5-chat 等
    messages = [
        {"role": "system", "content": "你是一个乐于助人的助手。"},
        {"role": "user", "content": "请用Python写一个快速排序算法"}
    ],
    max_tokens = 1024,
    temperature = 0.6 # 官方建议区间0.3-0.7
)

print(response.choices[0].message.content)
```

#### cURL (HTTP API)
通过命令行工具直接发起请求。

```bash
# 中国大陆
export BASE_URL="https://api.minimaxi.com/v1/chat/completions"
# 国际 (无需代理)
export BASE_URL="https://api.minimax.io/v1/chat/completions"

curl -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer QC-你的API-KEY" \
  -H "x-group-id: 你的Group-ID" \  # 关键：必需
  -d '{
    "model": "MiniMax-M2.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 💡 最佳实践与注意事项
*   **🔐 API Key 安全**：强烈建议通过环境变量设置 API Key，切勿硬编码。
*   **🇨🇳 区分版与Group ID**：务必选择正确的Base URL；如果使用了OpenAI兼容模式调用，请确认是 `v1/chat/completions` 还是 `/v1` 路径。
*   **⚙️ 参数调优**：合理使用`temperature`和`max_tokens`等参数，对于成本敏感的应用，可关注TPS（每秒Tokens数）性能。

### 📞 帮助与支持
*   **官方文档**：[https://platform.minimaxi.com/docs/llms.txt](https://platform.minimaxi.com/docs/llms.txt)
*   **商务合作**：如需更高资源保障，请联系`api@minimaxi.com`