# HybridBridge Usage Documentation

English | [简体中文](./README.CN.md)

HybridBridge is a lightweight bridging library enabling **bidirectional communication** between H5 (web) and native platforms (Android/iOS). It supports **message sending**, **event listening**, and a **request-response pattern with timeout**. It is designed for hybrid app development scenarios where H5 pages are embedded in a WebView and need to interact with native code.

---

## 1. Core Capabilities

- **H5 → Native**: Send messages via `postMessage`
- **Native → H5**: Receive native messages through `window.postMessage`
- **Request-Response Mode**: Supports asynchronous calls with timeout (RPC-like)
- **Event Subscription/Unsubscription**: Listen to or unsubscribe from native-pushed events using `on` / `off`
- **Automatic Platform Compatibility**: Automatically detects native-injected bridge objects on Android/iOS
- **Safe Parsing**: Automatically parses incoming JSON and guards against null/invalid values

---

## 2. Usage on the H5 Side

### 1. Send a message to native (fire-and-forget)

```ts
import { hybridBridge } from './HybridBridge';

// Send a one-way message
hybridBridge.postMessage({
  type: 'logEvent',
  data: { action: 'click', page: 'home' }
});
```

### 2. Send a message and wait for a native response (recommended for data retrieval)

```ts
try {
  const userInfo = await hybridBridge.postMessage({
    type: 'getUserInfo',
    timeout: 3000 // optional; default is 5000ms
  });
  console.log('User info:', userInfo);
} catch (error) {
  console.error('Failed to fetch user info:', error.message);
}
```

> **Note**: Response mode is only enabled when `timeout` is specified (even if set to `0`). The native side must respond with a message of `type: 'response'` and include the same `requestId`.

### 3. Listen to messages actively pushed from native

```ts
const handler = (data) => {
  console.log('Received native push:', data);
};

// Subscribe
hybridBridge.on('pushNotification', handler);

// Unsubscribe (optional)
hybridBridge.off('pushNotification', handler);

// Unsubscribe all listeners for this event type
hybridBridge.off('pushNotification');
```

---

## 3. Native-side Integration Specification

### 1. Android

Inject a JavaScript interface named `Android` in the WebView’s hosting Activity:

```java
webView.addJavascriptInterface(new HybridBridgeInterface(), "Android");

public class HybridBridgeInterface {
    @JavascriptInterface
    public void postMessage(String message) {
        // `message` is a JSON string, e.g.:
        // {"type":"getUserInfo","requestId":"req_1_1729012345678"}
        try {
            JSONObject json = new JSONObject(message);
            String type = json.getString("type");
            String requestId = json.optString("requestId", null);
            JSONObject data = json.optJSONObject("data");

            // Handle business logic...

            // If it's a request (has requestId), send a response back
            if (requestId != null) {
                JSONObject response = new JSONObject();
                response.put("type", "response");
                response.put("requestId", requestId);
                response.put("data", yourResultJson); // can be null or valid JSON

                String js = "window.postMessage(" + response.toString() + ", '*');";
                webView.post(() -> webView.evaluateJavascript(js, null));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

### 2. iOS (WKWebView)

Register a script message handler named `Bridge`:

```swift
// Register handler
webView.configuration.userContentController.add(self, name: "Bridge")

// Implement delegate
func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "Bridge", let body = message.body as? String {
        // `body` is a JSON string
        if let data = body.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let type = json["type"] as? String
            let requestId = json["requestId"] as? String
            let payload = json["data"] as? [String: Any]

            // Handle business logic...

            // If it's a request, send a response back
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

### 3. Native-initiated message push to H5

Native code can push messages to H5 by calling `window.postMessage` (H5 listens via `on`):

```js
// Android
webView.evaluateJavascript("window.postMessage('{\"type\":\"networkStatus\",\"data\":{\"online\":false}}', '*');", null);

// iOS
let script = "window.postMessage('{\"type\":\"locationUpdate\",\"data\":{\"lat\":39.9,\"lng\":116.4}}', '*');"
webView.evaluateJavaScript(script)
```

> **Note**: The message must be a **valid JSON string** containing a `type` field.

---

## 4. Important Notes

1. **Safe Parsing**: The internal `safeParse` utility automatically handles empty objects, invalid JSON, `'{}'` strings, etc., returning `null` as a fallback.
2. **Timeout Handling**: In request-response mode, the Promise rejects if the native side doesn’t respond within the specified `timeout`.
3. **requestId Generation**: Format is `req_{incrementalID}_{timestamp}` to ensure global uniqueness.
4. **Memory Management**: Use `off` to prevent listener memory leaks; pending requests are automatically cleaned up after timeout.
5. **Debugging Tips**: If the bridge doesn’t work, verify:
   - Android has correctly injected the `Android` object
   - iOS has registered the `Bridge` message handler
   - Native code calls JavaScript on the main thread

---

## 5. Example Use Case

### Scenario: H5 fetches user login status

```ts
// H5
const loginStatus = await hybridBridge.postMessage({
  type: 'getLoginStatus',
  timeout: 2000
});
// loginStatus = { isLoggedIn: true, userId: '123' }
```

```java
// Android (upon receiving the message)
if ("getLoginStatus".equals(type)) {
  JSONObject result = new JSONObject();
  result.put("isLoggedIn", true);
  result.put("userId", "123");
  // Send back the response...
}
```

---

> This bridge library has been stably deployed in production and is well-suited for TypeScript + H5 + WebView hybrid architectures.