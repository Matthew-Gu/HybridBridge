type HybridHandler = (data: any) => void;

interface HybridMessage<T = any> {
	type: string;
	requestId?: string;
	data?: T;
}

interface PostMessageOptions<T = any> {
	type: string;
	data?: T;
	/** 超时时间（毫秒），设置后自动启用响应模式，默认 5000ms */
	timeout?: number;
}

export const safeParse = (data: any, fallback = null) => {
	const isEmptyObject = (obj: any) =>
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
	private handlers = new Map<string, HybridHandler[]>();
	private pendingRequests = new Map<
		string,
		{ resolve: (res: any) => void; reject: (err: Error) => void; timeoutId: number }
	>();
	private counter = 0;
	private TIMEOUT = 1000 * 5;

	constructor() {
		window.addEventListener('message', this.onMessage.bind(this));
	}

	private onMessage(event: MessageEvent) {
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

	private sendToNative(msg: HybridMessage) {
		const json = JSON.stringify(msg);

		if ((window as any).Android?.postMessage) {
			(window as any).Android.postMessage(json);
			return;
		}

		if ((window as any).webkit?.messageHandlers?.Bridge?.postMessage) {
			(window as any).webkit.messageHandlers.Bridge.postMessage(json);
			return;
		}

		console.warn('HybridBridge: Native bridge not injected!', msg);
	}

	/**
	 * 发送消息到原生
	 */
	postMessage<T = any, R = any>(options: PostMessageOptions<T>): Promise<R> | void {
		const { type, data, timeout } = options;

		if (timeout !== undefined) {
			const requestId = `req_${++this.counter}_${Date.now()}`;
			const message: HybridMessage<T> = { type, data, requestId };

			const effectiveTimeout = timeout > 0 ? timeout : this.TIMEOUT;

			const promise = new Promise<R>((resolve, reject) => {
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

	on(type: string, handler: HybridHandler) {
		if (!this.handlers.has(type)) {
			this.handlers.set(type, []);
		}
		this.handlers.get(type)!.push(handler);
	}

	off(type: string, handler?: HybridHandler) {
		if (!this.handlers.has(type)) return;

		if (!handler) {
			this.handlers.delete(type);
		} else {
			const handlers = this.handlers.get(type)!;
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
