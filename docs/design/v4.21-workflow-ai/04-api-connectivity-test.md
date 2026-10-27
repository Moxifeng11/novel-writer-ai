# API 配置连通性测试功能规范

## 一、目标

在设置页 API 配置区域提供“一键测试当前提供商”，自动验证：

1. 端点 URL 合法且可达；
2. 网络与 CORS（Obsidian `requestUrl`）可用；
3. 鉴权是否通过；
4. 模型是否可调用；
5. 延迟是否异常。

测试结果以状态文本、颜色、Notice 告警呈现；不记录或展示密钥。

## 二、实现位置

| 模块 | 文件 | 职责 |
|---|---|---|
| 探测服务 | `services/api-connectivity-service.ts` | 端点规范化、最小请求、状态分类、延迟统计 |
| 设置界面 | `ui/settings-tab.ts` | “🔌 测试连通性”按钮、状态徽标、Notice 告警 |
| 数据来源 | `main.ts` 设置与 provider 列表 | 当前端点、模型、密钥、sourceType |

## 三、探测流程

```text
点击「测试连通性」
  ↓
读取当前 provider endpoint / model / key / sourceType
  ↓
端点规范化（补 /v1/chat/completions 或保留 /api/chat）
  ↓
本地端点允许无密钥；云端缺密钥直接失败
  ↓
POST 最小 chat 请求（8 token，temperature=0，stream=false）
  ↓
15s 超时
  ↓
状态分类 → 状态文本 + 颜色 + Notice
```

### 3.1 请求参数

| 参数 | 值 | 说明 |
|---|---|---|
| method | POST | OpenAI 兼容 chat |
| body（OpenAI） | `{model,messages:[{role:user,content:"Reply with OK."}],max_tokens:8,temperature:0,stream:false}` | 最小消耗 |
| body（Ollama `/api/chat`） | `{model,messages,stream:false,options:{num_predict:8,temperature:0}}` | 本地兼容 |
| headers | `Content-Type: application/json` + `Authorization: Bearer <key>` | 本地可无 key |
| timeout | 15,000ms | 防挂起 |
| degraded 阈值 | 5,000ms | 慢但可用 |

### 3.2 端点规范化

- 已以 `/chat/completions` 或 `/api/chat` 结尾：原样使用。
- 以 `/v1` 或 `/api/v3` 结尾：补 `/chat/completions`。
- 其它：补 `/v1/chat/completions`。

## 四、状态与告警

| HTTP/异常 | status | level | 文案 |
|---|---|---|---|
| 2xx + 有效响应 | ok | ok | 连通正常（Nms） |
| 2xx + 空响应 | empty_response | warn | 端点/鉴权通过但响应为空 |
| 2xx + error body | unknown_error | error | HTTP 200 但返回错误 |
| 延迟 > 5s | degraded | warn | 连通正常但响应较慢 |
| 401/403 | auth_failed | error | 鉴权失败 |
| 404 | not_found | error | 端点或模型不存在 |
| 408 | timeout | error | 请求超时 |
| 429 | rate_limited | warn | 请求被限流 |
| 5xx | server_error | error | 服务端错误 |
| 网络异常 | network_error | error | 网络错误 |
| 缺端点/模型/密钥 | invalid_config/auth_failed | error | 配置不完整 |

告警规则：

- `ok`：绿色状态 + 4s Notice。
- `warn`：黄色状态 + 8s Notice。
- `error`：红色状态 + 10s Notice；设置页保留错误详情供排查。

## 五、交互逻辑

1. 按钮位于 API 提供商选择/管理区域下方，密钥输入框上方。
2. 点击后按钮禁用并显示“⏳ 测试中…”，防止重复请求。
3. 状态元素依次显示“正在检测…”→ 结果；颜色随 level 变化。
4. 测试完成后按钮恢复；不自动保存设置（使用当前内存值）。
5. 若切换提供商，测试区域随设置页重渲染，状态回到“未测试”。
6. 云端提供商缺少密钥时，不发请求，直接提示鉴权失败。
7. 本地 Ollama 端点允许无密钥。

## 六、功能边界

- 只测试当前选中的 provider，不批量测试全部 provider。
- 只发起一次最小 chat 请求；不测试流式、工具调用、图片、embedding。
- 不验证余额/配额；429 只作为限流告警。
- 不绕过付费墙、不读取完整响应正文到日志。
- 不把密钥写入状态文本/Notice/日志。

## 七、验收标准

1. 正确端点 + 有效密钥 + 有效模型 → 绿色“连通正常”。
2. 错误密钥 → 红色“鉴权失败”，不发第二次请求。
3. 不存在模型 → 红色“端点或模型不存在”。
4. 限流 → 黄色“请求被限流”。
5. 本地无密钥 Ollama → 可测试并返回结果。
6. 15 秒无响应 → 红色“请求超时”，按钮恢复可用。
7. 连续点击不会产生并发探测。
8. 单元测试覆盖 ok/auth/rate-limit/200-error/empty/invalid-config/local 八类场景。

## 八、落地步骤

1. 新增 `services/api-connectivity-service.ts`（已完成）。
2. `ui/settings-tab.ts` 引入服务并在 API 区插入按钮/状态（已完成）。
3. 单元测试：`tests/unit/services/api-connectivity-service.test.ts`（已完成）。
4. 运行时验证：真实 provider 成功/失败各一次；确认按钮、颜色、Notice、超时。
5. 回归：不影响设置保存、provider 切换与密钥显示/隐藏。
