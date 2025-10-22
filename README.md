# HybridBridge 使用说明文档

HybridBridge 是一个用于 H5 与原生（Android / iOS）双向通信的轻量级桥接库，支持**消息发送**、**事件监听**和**带超时的请求-响应模式**。适用于混合开发（Hybrid App）场景，如 WebView 中嵌入 H5 页面并与原生交互。

---

## 一、核心能力

- **H5 → Native**：通过 `postMessage` 发送消息
- **Native → H5**：通过 `window.postMessage` 接收原生消息
- **请求-响应模式**：支持带超时的异步调用（类似 RPC）
- **事件订阅/取消**：`on` / `off` 监听原生主动推送的消息
- **自动兼容 Android / iOS**：自动识别原生注入的桥接对象
- **安全解析**：对传入数据自动 JSON 解析并防御空/无效值

---

## 二、H5 端使用方式

### 1. 发送消息到原生（无需响应）

```ts
import { hybridBridge } from './HybridBridge';

// 发送普通消息（fire-and-forget）
hybridBridge.postMessage({
  type: 'logEvent',
  data: { action: 'click', page: 'home' }
});
```

### 2. 发送消息并等待原生响应（推荐用于获取数据）

```ts
try {
  const userInfo = await hybridBridge.postMessage({
    type: 'getUserInfo',
    timeout: 3000 // 可选，默认 5000ms
  });
  console.log('用户信息:', userInfo);
} catch (error) {
  console.error('获取用户信息失败:', error.message);
}
```

> 注意：只有设置了 `timeout`（即使为 0）才会启用响应模式，原生必须回传 `type: 'response'` 且携带相同 `requestId`。

### 3. 监听原生主动推送的消息

```ts
const handler = (data) => {
  console.log('收到原生推送:', data);
};

// 订阅
hybridBridge.on('pushNotification', handler);

// 取消订阅（可选）
hybridBridge.off('pushNotification', handler);

// 取消该类型所有监听
hybridBridge.off('pushNotification');
```

---

## 三、原生端（Native）对接规范

### 1. Android 端

需在 WebView 所在 Activity 中注入名为 `Android` 的 JavaScript 接口：

```java
webView.addJavascriptInterface(new HybridBridgeInterface(), "Android");

public class HybridBridgeInterface {
    @JavascriptInterface
    public void postMessage(String message) {
        // message 是 JSON 字符串，例如：
        // {"type":"getUserInfo","requestId":"req_1_1729012345678"}
        try {
            JSONObject json = new JSONObject(message);
            String type = json.getString("type");
            String requestId = json.optString("requestId", null);
            JSONObject data = json.optJSONObject("data");

            // 处理业务逻辑...

            // 如果是请求（有 requestId），需回传响应
            if (requestId != null) {
                JSONObject response = new JSONObject();
                response.put("type", "response");
                response.put("requestId", requestId);
                response.put("data", yourResultJson); // 可为 null 或有效 JSON

                String js = "window.postMessage(" + response.toString() + ", '*');";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

### 2. iOS (WKWebView) 端

需注册名为 `Bridge` 的 script message handler：

```swift
// 注册 handler
webView.configuration.userContentController.add(self, name: "Bridge")

// 实现代理
func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "Bridge", let body = message.body as? String {
        // body 是 JSON 字符串
        if let data = body.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let type = json["type"] as? String
            let requestId = json["requestId"] as? String
            let payload = json["data"] as? [String: Any]

            // 处理业务...

            // 若为请求，需回传响应
            if let requestId = requestId {
                var response: [String: Any] = [
                    "type": "response",
                    "requestId": requestId
                ]
                if let result = yourResultDict {
                    response["data"] = result
                }

                if let responseData = try? JSONSerialization.data(withJSONObject: response),
                   let jsonString = String(data: responseData, encoding: .utf8) {
                    let script = "window.postMessage(\(jsonString), '*');"
                    webView.evaluateJavaScript(script)
                }
            }
        }
    }
}
```

### 3. 原生主动推送消息到 H5

原生可通过 `window.postMessage` 向 H5 发送事件（H5 通过 `on` 监听）：

```js
// Android
webView.evaluateJavascript("window.postMessage('{\"type\":\"networkStatus\",\"data\":{\"online\":false}}', '*');", null);

// iOS
let script = "window.postMessage('{\"type\":\"locationUpdate\",\"data\":{\"lat\":39.9,\"lng\":116.4}}', '*');"
webView.evaluateJavaScript(script)
```

> 注意：发送的必须是 **合法 JSON 字符串**，且包含 `type` 字段。

---

## 四、注意事项

1. **安全解析**：`safeParse` 会自动处理空对象、无效 JSON、`'{}'` 字符串等，返回 `null` 作为兜底。
2. **超时机制**：响应模式下若原生未在 `timeout` 内回复，Promise 会 reject。
3. **requestId 生成**：格式为 `req_{自增ID}_{时间戳}`，确保全局唯一。
4. **内存管理**：`off` 可防止监听器内存泄漏；pending 请求超时后自动清理。
5. **调试建议**：若桥接未生效，请检查：
   - Android 是否正确注入 `Android` 对象
   - iOS 是否注册了 `Bridge` handler
   - 原生是否在主线程调用 JS

---

## 五、示例场景

### 场景：H5 获取用户登录状态

```ts
// H5
const loginStatus = await hybridBridge.postMessage({
  type: 'getLoginStatus',
  timeout: 2000
});
// loginStatus = { isLoggedIn: true, userId: '123' }
```

```java
// Android 收到消息后
if ("getLoginStatus".equals(type)) {
  JSONObject result = new JSONObject();
  result.put("isLoggedIn", true);
  result.put("userId", "123");
  // 回传 response...
}
```

---

> 本桥接库已在实际项目中稳定运行，适用于 TypeScript + H5 + WebView 混合开发架构。
