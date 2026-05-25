这份指南整合了通过API接入通义千问模型的核心信息，包括本地连接地址、模型选择、密钥申请和具体调用方法，希望能帮助你快速上手。

### 🌐 服务地址 (Base URL)
通义千问提供与OpenAI兼容的API接口，本地连接时需配置正确的Base URL。

| 服务地域 | Base URL (SDK配置) | HTTP Endpoint |
| :--- | :--- | :--- |
| **中国大陆** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 中国（香港） | `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1` | `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 新加坡 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` |
| 美国（弗吉尼亚） | `https://dashscope-us.aliyuncs.com/compatible-mode/v1` | `https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions` |

### 🤖 核心模型
阿里云百炼平台提供多种通义千问模型，可按需选择。

| 模型系列 | 模型ID | 核心特点 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **Qwen-Max** | `qwen-max`, `qwen3-max`等 | 旗舰级，最强推理能力 | 复杂逻辑推理、长文本生成、高度智能化任务 |
| **Qwen-Plus** | `qwen-plus`, `qwen3.5-plus`等 | 性能、速度和成本均衡 | 中等复杂度任务，如内容创作、文本摘要、对话 |
| **Qwen-Turbo** | `qwen-turbo`, `qwen3.5-flash`等 | 轻量级，响应速度快，成本低 | 日常对话、简单问答、原型验证 |
| **Qwen-VL** | `qwen-vl-max`, `qwen-vl-plus` | 支持图像、视频等多模态理解 | 图像描述、视觉问答、图文识别等 |

### 0️⃣ 预备工作：获取API Key

1.  **注册并开通服务**：登录[阿里云官网](https://www.aliyun.com/)，完成**企业或个人实名认证**。在“大模型服务平台百炼”中，开通“通义千问”服务。
2.  **创建API Key**：在“百炼”控制台的“API-KEY管理”页面，点击“创建API-KEY”，系统将生成一个**`sk-`开头**的密钥，请妥善保存。

### 💻 调用方式

#### Python (OpenAI SDK) - 推荐
这是最通用的方式。如果仅使用 `openai` 库遇到网络问题，可尝试升级到最新版本。

```python
# 1. 安装依赖：pip install -U openai

from openai import OpenAI

client = OpenAI(
    api_key = "YOUR_API_KEY",  # 替换为你的API Key，也可设置为环境变量
    base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1",  # 中国大陆地域Base URL
)

response = client.chat.completions.create(
    model = "qwen-max",  # 或 "qwen-plus", "qwen-turbo"
    messages = [
        {"role": "system", "content": "你是一个乐于助人的助手。"},
        {"role": "user", "content": "请用Python写一个快速排序算法"}
    ],
    max_tokens = 1024,
    temperature = 0.7
)

print(response.choices[0].message.content)
```
> 以上代码片段来源于阿里云官方文档及CSDN博客。

#### Python (DashScope SDK)
DashScope是阿里云官方的Python SDK，也可以参考以下示例进行调用。

#### cURL (HTTP API)
通过命令行工具直接发起HTTP请求。
```bash
curl -X POST "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-turbo",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ]
  }'
```
**返回值**：接口会返回一个JSON对象，其中`choices[0].message.content`字段包含了模型的回答。你可能会获得包含`reasoning_content`字段的回复，这是模型的思考过程（当模型被配置为“思考模式”时）。

### 💡 最佳实践与注意事项

*   **🔐 API Key安全**：强烈建议将API Key设置为环境变量 (`DASHSCOPE_API_KEY`)，切勿硬编码在程序里或上传至公开仓库。
*   **⚙️ 参数调优**：合理设置`temperature`（控制随机性）和`max_tokens`（限制最大输出长度），以在响应质量和速度间取得平衡。
*   **💬 多轮对话**：通过在`messages`列表中传递完整的历史对话记录，实现上下文关联的多轮对话。继续使用时，在`messages`中追加新的用户提问和模型的回复即可。
*   **📡 流式输出**：将`stream`参数设为`true`，可以提升长文本生成的交互体验。
*   **💰 计费与免费额度**：初次注册将获赠一定额度的免费Token，可在控制台查看详细账单，按实际用量付费。

#### 故障排查

*   **鉴权失败 (401)**：检查API Key是否正确，确认是否已开通通义千问服务。
*   **模型不存在 (404/400)**：确保使用了正确的模型ID (例如 `qwen-max`)，确认该服务可在控制台查看。
*   **网络连接问题**：请确保你的网络环境可以正常访问阿里云服务。