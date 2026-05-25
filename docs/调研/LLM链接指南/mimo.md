要通过本地代码连接小米 MiMo 大模型，需要先获取 API 密钥，然后通过其提供的 OpenAI 兼容接口进行调用。

下面是核心步骤和配置信息。

### ✅ 前提条件

1.  **获取 API 密钥**：访问小米 MiMo 开放平台 [platform.xiaomimimo.com](https://platform.xiaomimimo.com)。登录/注册后，在控制台的 “API-Keys” 页面创建一个新的 API Key。请务必在创建后立刻复制并保存好，之后将无法再次查看。
2.  **准备开发环境**：确保安装了 Python 3.8+ 以及 `pip` 包管理工具，以便安装必要的库。

### 🚀 连接方法

MiMo 的接口高度兼容 OpenAI 的 API 协议，这意味着你可以继续使用熟悉的 `openai` Python 库或通用的 `requests` 库进行调用。

#### 方案一：使用 openai 库（推荐）

```python
# 1. 安装依赖：pip install -U openai

from openai import OpenAI

client = OpenAI(
    api_key = "这里填你的API密钥",      # 替换为你的API Key
    base_url = "https://api.xiaomimimo.com/v1"  # ★ 关键：替换为MiMo的API地址
)

response = client.chat.completions.create(
    model = "mimo-v2-flash",  # 指定要使用的模型
    messages = [
        {"role": "system", "content": "你是一个乐于助人的助手。"},
        {"role": "user", "content": "请用Python写一个快速排序算法"}
    ],
    max_tokens = 1024,
    temperature = 0.7
)

print(response.choices[0].message.content)
```

#### 方案二：使用 requests 库

如果你希望减少依赖或进行更底层的控制，可以使用标准的 `requests` 库。

```python
# 1. 安装依赖：pip install requests

import requests

url = "https://api.xiaomimimo.com/v1/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer 这里填你的API密钥"  # 使用 Bearer 令牌鉴权
}
data = {
    "model": "mimo-v2-flash",
    "messages": [
        {"role": "user", "content": "你好，请简单介绍下自己"}
    ],
    "max_tokens": 1024,
    "temperature": 0.7
}

response = requests.post(url, headers=headers, json=data)
print(response.json())  # 打印完整的JSON响应
```

### 🧠 连接核心：配置信息一览

无论使用哪种方法，都需要在代码中正确设置以下关键信息：

| 配置项 | 值 / 说明 | 备注 |
| :--- | :--- | :--- |
| **API 地址 (Base URL)** | `https://api.xiaomimimo.com/v1`或 `https://api.xiaomimimo.com/anthropic` | 根据使用的API兼容格式选择，`/v1` 为OpenAI格式。 |
| **模型名称 (Model)** | 例如：`mimo-v2-flash`, `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2-omni` | 具体名称请参考官方文档或后续的模型列表。 |
| **认证方式 (Authentication)** | `api-key` 或 `Authorization: Bearer <YOUR_API_KEY>` | `openai` 库自动处理，`requests` 库通常用 `Bearer` 方式。 |
| **主要接口端点** | `/v1/chat/completions` | 用于调用模型的对话补全接口。 |

### 📚 模型与扩展能力速览

为方便你选择合适的模型，整理了部分常用模型的能力与参数：

| 模型系列 | 核心特点 | 推荐场景 |
| :--- | :--- | :--- |
| `mimo-v2.5-pro` / `mimo-v2.5` | Agent专用模型，原生支持多模态（能同时处理图像，音频和视频），性能强劲有成本优化 | Agent任务，通用应用开发 |
| `mimo-v2-pro` | 旗舰基座模型，拥有百万级上下文窗口 | 高强度推理，复杂文档处理 |
| `mimo-v2-flash` | 轻量快速，上下文为262k Tokens | 日常对话，快速原型验证 |
| `mimo-v2-omni` | 支持文本与图像混合输入，具备推理能力 | 多模态应用开发 |
| `mimo-v2.5-tts` | 官方文本转语音模型  | 需要自然语音输出的应用 |

调用时可以通过配置 `chat_template_kwargs: {"enable_thinking": true}` 开启模型的思考链（Chain-of-Thought）。响应中会额外包含 `reasoning_content` 字段，记录模型的推理过程。

### 💡 实践建议

如果报错 `404 Not Found` 或 `401 Unauthorized`，请仔细检查 **API 地址 (Base URL)** 中的 `/v1` 和 API Key 是否输入无误，或者尝试在 `Authorization` 头中用 `api-key` 替代 `Bearer`。