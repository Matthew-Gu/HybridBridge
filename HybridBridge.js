export const safeParse = (data, fallback = null) => {
	const isEmptyObject = (obj) =>
		typeof obj === 'object' && obj !== null && !Array.isArray(obj) && Object.keys(obj).length === 0;

	if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
		return isEmptyObject(data) ? fallback : data;
	}

	if (typeof data === 'string') {
		const cleaned = data.trim();
		if (['', '{}', '[]', 'null', 'undefined'].includes(cleaned)) return fallback;
		try {
			const parsed = JSON.parse(cleaned);
			return isEmptyObject(parsed) ? fallback : parsed;
		} catch {
			return fallback;
		}
	}

	return fallback;
};

class HybridBridge {
	constructor() {
		this.handlers = new Map();
		this.pendingRequests = new Map();
		this.counter = 0;
		this.TIMEOUT = 5000; // 5 seconds

		window.addEventListener('message', this.onMessage.bind(this));
	}

	onMessage(event) {
		const msg = safeParse(event.data);
		if (!msg?.type) return;

		if (msg.type === 'response' && msg.requestId) {
			const req = this.pendingRequests.get(msg.requestId);
			if (req) {
				clearTimeout(req.timeoutId);
				this.pendingRequests.delete(msg.requestId);
				req.resolve(safeParse(msg.data));
			}
			return;
		}

		const listeners = this.handlers.get(msg.type);
		if (Array.isArray(listeners)) {
			listeners.forEach((fn) => fn(safeParse(msg.data)));
		}
	}

	sendToNative(msg) {
		const json = JSON.stringify(msg);

		if (window.Android?.postMessage) {
			window.Android.postMessage(json);
			return;
		}

		if (window.webkit?.messageHandlers?.Bridge?.postMessage) {
			window.webkit.messageHandlers.Bridge.postMessage(json);
			return;
		}

		console.warn('HybridBridge: Native bridge not injected!', msg);
	}

	postMessage(options) {
		const { type, data, timeout } = options;

		if (timeout !== undefined) {
			const requestId = `req_${++this.counter}_${Date.now()}`;
			const message = { type, data, requestId };

			const effectiveTimeout = timeout > 0 ? timeout : this.TIMEOUT;

			const promise = new Promise((resolve, reject) => {
				const timeoutId = setTimeout(() => {
					this.pendingRequests.delete(requestId);
					reject(new Error(`[HybridBridge] Request timeout after ${effectiveTimeout}ms`));
				}, effectiveTimeout);

				this.pendingRequests.set(requestId, { resolve, reject, timeoutId });
			});

			this.sendToNative(message);
			return promise;
		}

		this.sendToNative({ type, data });
	}

	on(type, handler) {
		if (!this.handlers.has(type)) {
			this.handlers.set(type, []);
		}
		this.handlers.get(type).push(handler);
	}

	off(type, handler) {
		if (!this.handlers.has(type)) return;

		if (!handler) {
			this.handlers.delete(type);
		} else {
			const handlers = this.handlers.get(type);
			const filtered = handlers.filter((h) => h !== handler);
			if (filtered.length === 0) {
				this.handlers.delete(type);
			} else {
				this.handlers.set(type, filtered);
			}
		}
	}
}

export const hybridBridge = new HybridBridge();
