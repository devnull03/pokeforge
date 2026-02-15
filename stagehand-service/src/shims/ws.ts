/**
 * ws-compatible shim for Cloudflare Workers.
 *
 * Bridges the gap between the native Workers WebSocket (browser-style events)
 * and Node.js `ws` library expectations (EventEmitter-style with raw data args).
 *
 * Key translations:
 *   Browser  MessageEvent   -> ws  on('message', (data, isBinary) => ...)
 *   Browser  CloseEvent     -> ws  on('close', (code, reason) => ...)
 *   Browser  Event('open')  -> ws  on('open', () => ...)
 *   Browser  Event('error') -> ws  on('error', (err) => ...)
 */

type WsListener = (...args: unknown[]) => void;

class WorkerWebSocket extends WebSocket {
	private _emitterListeners = new Map<string, Set<{ fn: WsListener; once: boolean }>>();

	constructor(address: string | URL, protocols?: string | string[], _options?: unknown) {
		super(String(address), protocols);
		this.binaryType = "arraybuffer";
	}

	/* ---------- EventEmitter-style API (what ws / playwright / stagehand call) ---------- */

	on(event: string, listener: WsListener): this {
		return this._addListener(event, listener, false);
	}

	addListener(event: string, listener: WsListener): this {
		return this._addListener(event, listener, false);
	}

	once(event: string, listener: WsListener): this {
		return this._addListener(event, listener, true);
	}

	off(event: string, listener: WsListener): this {
		return this.removeListener(event, listener);
	}

	removeListener(event: string, listener: WsListener): this {
		const set = this._emitterListeners.get(event);
		if (!set) return this;
		for (const entry of set) {
			if (entry.fn === listener) {
				set.delete(entry);
				break;
			}
		}
		return this;
	}

	removeAllListeners(event?: string): this {
		if (event) {
			this._emitterListeners.delete(event);
		} else {
			this._emitterListeners.clear();
		}
		return this;
	}

	emit(event: string, ...args: unknown[]): boolean {
		const set = this._emitterListeners.get(event);
		if (!set || set.size === 0) return false;
		const toRemove: Array<{ fn: WsListener; once: boolean }> = [];
		for (const entry of set) {
			entry.fn(...args);
			if (entry.once) toRemove.push(entry);
		}
		for (const entry of toRemove) set.delete(entry);
		return true;
	}

	/* Node ws exposes .ping / .pong — they're no-ops here but must not throw */
	ping(_data?: unknown, _mask?: boolean, _cb?: () => void): void {}
	pong(_data?: unknown, _mask?: boolean, _cb?: () => void): void {}

	/* Node ws .terminate() — just close immediately */
	terminate(): void {
		try {
			this.close();
		} catch {
			// ignore
		}
	}

	/* ---------- Internal ---------- */

	private _addListener(event: string, listener: WsListener, once: boolean): this {
		let set = this._emitterListeners.get(event);
		if (!set) {
			set = new Set();
			this._emitterListeners.set(event, set);
			// First time seeing this event name: wire up a native WebSocket listener
			// that translates browser events into Node ws-style callback args.
			this._wireNativeEvent(event, set);
		}
		set.add({ fn: listener, once });
		return this;
	}

	private _wireNativeEvent(event: string, set: Set<{ fn: WsListener; once: boolean }>): void {
		const dispatch = (...args: unknown[]) => {
			const toRemove: Array<{ fn: WsListener; once: boolean }> = [];
			for (const entry of set) {
				try {
					entry.fn(...args);
				} catch {
					// don't let one listener break others
				}
				if (entry.once) toRemove.push(entry);
			}
			for (const entry of toRemove) set.delete(entry);
		};

		switch (event) {
			case "open":
				this.addEventListener("open", () => dispatch());
				break;

			case "message":
				this.addEventListener("message", (evt: MessageEvent) => {
					// Node ws passes (data: Buffer|string, isBinary: boolean)
					const data = evt.data;
					const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array;
					dispatch(data, isBinary);
				});
				break;

			case "close":
				this.addEventListener("close", (evt: CloseEvent) => {
					// Node ws passes (code: number, reason: Buffer)
					dispatch(evt.code, evt.reason);
				});
				break;

			case "error":
				this.addEventListener("error", (evt: Event) => {
					// Node ws passes (err: Error)
					dispatch(new Error((evt as ErrorEvent).message ?? "WebSocket error"));
				});
				break;

			case "unexpected-response":
			case "upgrade":
			case "ping":
			case "pong":
				// These events don't exist on browser WebSocket — silently ignore.
				break;

			default:
				// Unknown event — try to wire a generic listener
				this.addEventListener(event, (evt: Event) => dispatch(evt));
				break;
		}
	}
}

class WorkerWebSocketServer {
	constructor() {
		throw new Error("WebSocketServer is not supported in Cloudflare Workers.");
	}
}

export default WorkerWebSocket;
export { WorkerWebSocket as WebSocket, WorkerWebSocketServer as WebSocketServer };
