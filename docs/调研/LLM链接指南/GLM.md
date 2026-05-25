## 智谱AI开放平台本地连接指导文档


### 一、概述

智谱AI开放平台提供标准的HTTP API接口，支持通过本地环境调用平台上的各类大模型。开发者可使用任意支持HTTP请求的编程语言接入，平台同时提供Python SDK、Java SDK等工具以简化开发工作。


### 二、接入前准备

#### 2.1 注册账号

访问智谱开放平台（https://open.bigmodel.cn），点击右上角「注册/登录」按钮完成注册流程。

#### 2.2 获取API Key

登录后进入个人中心，点击API Keys页面（https://bigmodel.cn/usercenter/proj-mgmt/apikeys），创建一个新的API Key。

> ⚠️ **安全提示**：请妥善保管您的API Key，不要泄露给他人，也不要直接硬编码在代码中。建议使用环境变量或配置文件来存储。

#### 2.3 选择模型

平台提供多种模型，可根据需求选择。详细的模型介绍可参考官方模型概览。

当前主流模型选型参考：

| 模型 | 定位 | 上下文 | 最大输出 | 适用场景 |
|------|------|--------|----------|----------|
| GLM-5.1 | 最新旗舰 | 200K | 128K | 高级编程、复杂长程任务（可自主工作8小时） |
| GLM-4.7 | 高智能模型 | 200K | 128K | 通用对话、推理与智能体全面升级 |
| GLM-4.7-Flash | 免费模型 | 200K | 128K | 最新基座模型的普惠版本，零成本接入 |
| GLM-4.5-Air | 高性价比 | 128K | 96K | 推理、编码和智能体任务 |
| GLM-4-Long | 超长输入 | 1M | 4K | 超长文本处理和记忆型任务 |
| GLM-4.6V | 视觉理解 | 200K | 128K | 图像和文本混合输入处理 |
| GLM-Z1 | 推理模型 | — | — | 深度思考、数理推理、逻辑推理 |
| GLM-4.1V-Thinking | 视觉推理 | — | — | 图表理解、前端Coding、GUI任务 |

### 三、请求格式

所有API请求遵循以下通用格式规范：

#### 3.1 接口信息

| 项目 | 规范 |
|------|------|
| 请求地址 | `https://open.bigmodel.cn/api/paas/v4/chat/completions`（通用）<br>`https://open.bigmodel.cn/api/coding/paas/v4`（Coding套餐专用） |
| 请求方法 | POST |
| 字符编码 | UTF-8 |
| 请求格式 | JSON |
| Content-Type | `application/json` |

> ⚠️ **注意**：Coding API端点仅限编码场景使用，不适用于通用API场景，请区分使用。

#### 3.2 请求Header

```http
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

> 🔐 **鉴权说明**：开放平台API使用标准的HTTP Bearer方式进行身份验证，Authorization头中Bearer与API Key之间需带空格。

#### 3.3 请求Body参数

| 参数名 | 类型 | 必选 | 说明 |
|--------|------|------|------|
| `model` | string | ✅ | 所调用的模型编码 |
| `messages` | array | ✅ | 对话消息列表，按时间由旧到新排序 |
| `temperature` | float | ❌ | 控制生成随机性，默认0.6~1.0（因模型而异） |
| `stream` | boolean | ❌ | 是否启用流式返回，默认false |
| `tools` | array | ❌ | 函数调用工具定义参数 |
| `max_tokens` | integer | ❌ | 最大生成token数控制 |

#### 3.4 Messages格式

messages数组中的每条消息为对象，包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | 角色：`system`（系统指令）、`user`（用户）、`assistant`（助手） |
| `content` | string/array | 消息内容，文本模式为string，多模态模式为数组 |

#### 3.5 基础调用示例（cURL）

```bash
curl -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      { "role": "system", "content": "你是一个有用的AI助手。" },
      { "role": "user", "content": "你好，请介绍一下自己。" }
    ],
    "temperature": 0.6,
    "stream": false
  }'
```

### 四、Python SDK接入示例

#### 4.1 安装依赖（以zhipuai为例）

```bash
pip install zhipuai
```

或参考使用requests库调用：

```bash
pip install requests
```

#### 4.2 Python调用示例

**方式一：使用zhipuai SDK**（如有）

```python
from zhipuai import ZhipuAI

client = ZhipuAI(api_key="YOUR_API_KEY")

response = client.chat.completions.create(
    model="glm-4.7",
    messages=[
        {"role": "system", "content": "你是一个有用的AI助手"},
        {"role": "user", "content": "你好"}
    ]
)

print(response.choices[0].message.content)
```

**方式二：直接使用requests**

```python
import requests
import json

url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
}
data = {
    "model": "glm-4.7",
    "messages": [
        {"role": "system", "content": "你是一个有用的AI助手"},
        {"role": "user", "content": "你好"}
    ],
    "temperature": 0.6,
    "stream": False
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

### 五、响应格式

#### 5.1 非流式响应

Content-Type为`application/json`，一次性返回完整结果。

**响应结构**（主要字段）：

| 字段 | 说明 |
|------|------|
| `id` | 请求唯一标识 |
| `choices` | 生成结果列表 |
| `choices[].message.role` | 助手角色（assistant） |
| `choices[].message.content` | 生成的文本内容 |
| `usage` | Token使用统计 |

#### 5.2 流式响应（SSE）

设置`"stream": true`时，Content-Type为`text/event-stream`，模型以流式方式逐块返回内容。适用于需要实时展示生成效果的场景，可显著提升实时交互应用的体验。

### 六、高级功能

#### 6.1 多模态输入（视觉理解）

使用GLM-4.6V等视觉模型处理图像与文本混合输入：

```json
{
  "model": "glm-4.6v",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "这张图片描述了什么？" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
      ]
    }
  ]
}
```

> 💡 **最佳实践**：将图片放到本地目录，通过对话方式指定图片名称或路径来调用，避免在客户端直接粘贴图片后调用模型接口。

#### 6.2 函数调用（Tool Calling）

让模型调用您定义的函数：

```json
{
  "model": "glm-5.1",
  "messages": [
    { "role": "user", "content": "帮我查询北京到上海的航班" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_flight_number",
        "description": "根据始发地、目的地和日期查询航班号",
        "parameters": {
          "type": "object",
          "properties": {
            "departure": { "type": "string", "description": "出发地" },
            "destination": { "type": "string", "description": "目的地" },
            "date": { "type": "string", "description": "出发日期" }
          }
        }
      }
    }
  ]
}
```

### 七、错误处理

API响应码由HTTP状态码和业务错误码两部分组成，提供具体错误描述。

#### 7.1 HTTP状态错误码

| 状态码 | 原因 | 解决方法 |
|--------|------|----------|
| 200 | 成功 | — |
| 400 | 参数错误 | 检查接口参数是否正确 |
| 400 | 文件内容异常 | 检查jsonl文件内容是否符合要求 |
| 401 | 鉴权失败或Token超时 | 确认API Key和鉴权token是否正确生成 |
| 429 | 接口请求并发超额 | 调整请求频率或联系商务扩大并发数 |
| 429 | 账户余额已用完 | 进行账户充值以确保余额充足 |
| 435 | 文件大小超过100MB | 使用小于100MB的jsonl文件或分批上传 |
| 500 | 服务器内部错误 | 稍后重试或联系客服 |

#### 7.2 主要业务错误码

| 错误码 | 错误类型 | 说明 |
|--------|----------|------|
| 1002 | 鉴权错误 | Authentication Token非法 |
| 1113 | 账户错误 | 账户已欠费，请充值后重试 |
| 1211 | API调用错误 | 模型不存在，请检查模型代码 |
| 1261 | API调用错误 | Prompt超长 |
| 1301 | 策略阻止 | 输入或生成内容包含不安全或敏感内容 |
| 1302 | 策略阻止 | 账户已达速率限制 |
| 1305 | 策略阻止 | 模型当前访问量过大 |

### 八、速率限制

平台实施速率限制机制以保障服务稳定性：

1. **并发请求数限制**：不同模型设有独立的并发限制
2. **按套餐等级划分**：Lite / Pro / Max套餐对应不同并发上限
3. **高峰期动态限流**：高峰时期（如15:00-18:00）可能触发额外限制

用户可通过【速率限制】页面（https://bigmodel.cn/usercenter/proj-mgmt/rate-limits）查看账户的并发配额。

### 九、本地集成常见实践

#### 9.1 LangChain集成

通过LangChain框架无缝集成智谱大模型，建议按以下步骤操作：

1. 安装LangChain相关依赖
2. 在.env文件中配置API Key
3. 确保已开通目标模型权限，避免因权限不足导致调用失败

#### 9.2 RAG知识库接入

若需接入本地知识库，可通过以下技术方案实现：

- 用LangChain + ChromaDB构建本地知识库向量索引
- 部署量化ChatGLM模型并启用FastAPI服务
- 集成RAG检索与提示工程提升答案准确性

#### 9.3 AutoClaw本地化部署

智谱AI推出了一键安装、支持接入主流AI模型API的本地化部署工具，可根据项目需求选择使用。

### 十、注意事项与最佳实践

1. **编码问题**：请求编码必须为UTF-8，否则带中文的请求可能失败

2. **API Key安全**：
   - 建议将API Key设置为环境变量，避免硬编码到代码中
   - 新版API Key格式为`{id}.{secret}`

3. **调试工具**：在API详情页面右上方有丰富的调用示例，可点击Try it按钮快速调试API

4. **网络配置**：如遇API调用失败但网页推理正常，请检查网络配置是否恰当

5. **内容安全**：当系统检测到模型输入或输出中有违法及不良信息时，会返回错误码1301，不再同步生成结果

6. **私有实例部署**：对于金融、医疗、政企等对数据合规与隐私保护高要求的场景，可选择私有实例部署


> 📚 **相关资源**
> - 官方文档完整索引：https://docs.bigmodel.cn/llms.txt
> - API Key管理页：https://bigmodel.cn/usercenter/proj-mgmt/apikeys
> - 模型价格页面：https://open.bigmodel.cn/pricing
> - 客服邮箱：service@zhipuai.cn