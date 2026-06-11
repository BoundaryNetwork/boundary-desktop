import type { WsClientRequest, ServerMessage } from "../types";

export interface ChatWsOptions {
  /** 当前 ws base,如 ws://127.0.0.1:PORT/ws;端点未就绪返回 null(稍后重试)。 */
  url(): string | null;
  /** 当前登录 token;每次连接前现取(刷新/吊销后即最新),登出为 null。 */
  token(): string | null;
  /** 入帧分发(交给 handlers 的 dispatcher);pong 在本类内消费,不外抛。 */
  onFrame(frame: ServerMessage): void;
  onOpen?(): void;
  /** 连接态变化:open 时 true,close/teardown 时 false。供 composer 决定 placeholder/禁用。 */
  onStatus?(connected: boolean): void;
}

const MAX_BACKOFF_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 30_000;

/** 浏览器 WebSocket 不能设 Authorization 头:token 经 query 参数携带(鉴权用 ctx.auth.getToken())。
 *  待确认 worker /ws 接受 token 的线格式(query / Sec-WebSocket-Protocol / open 后首帧),
 *  以 worker 约定为准——改这里一处即可。 */
function buildUrl(base: string, token: string | null): string {
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export class ChatWs {
  #opts: ChatWsOptions;
  #ws: WebSocket | null = null;
  #closedByUser = false;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** 未开连时的发送缓冲:open 后 flush(参考 ws.ts pendingPayloads,避免首发丢失)。 */
  #pending: WsClientRequest[] = [];

  constructor(opts: ChatWsOptions) {
    this.#opts = opts;
  }

  connect(): void {
    this.#closedByUser = false;
    this.#open();
  }

  #open(): void {
    const base = this.#opts.url();
    if (!base) {
      this.#scheduleReconnect(); // 端点未就绪,稍后重试
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(buildUrl(base, this.#opts.token()));
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
      this.#flushPending();
      this.#startHeartbeat();
      this.#opts.onStatus?.(true);
      this.#opts.onOpen?.();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let frame: ServerMessage;
      try {
        frame = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return; // 非 JSON 帧忽略
      }
      if (frame.kind === "pong") {
        this.#onPong();
        return;
      }
      this.#opts.onFrame(frame);
    };
    ws.onclose = () => {
      this.#clearHeartbeat();
      this.#ws = null;
      this.#opts.onStatus?.(false);
      if (!this.#closedByUser) this.#scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close(); // 交给 onclose 接管重连
      } catch {
        /* already closing */
      }
    };
  }

  #scheduleReconnect(): void {
    if (this.#closedByUser || this.#reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.#attempt);
    this.#attempt++;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open();
    }, delay);
  }

  /** 端点变化(worker 重启换端口)时调:断开旧连、重连新地址。 */
  reconnect(): void {
    this.#teardownSocket();
    this.#attempt = 0;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#open();
  }

  /** 发帧:未开连则入队,open 时 flush(参考行为,避免首条 turn 丢失)。 */
  send(req: WsClientRequest): void {
    const ws = this.#ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(req));
    } else {
      this.#pending.push(req);
    }
  }

  close(): void {
    this.#closedByUser = true;
    this.#pending = [];
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#teardownSocket();
  }

  #flushPending(): void {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const toSend = this.#pending.splice(0);
    for (const req of toSend) ws.send(JSON.stringify(req));
  }

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#pingTimer = setInterval(() => {
      this.send({ type: "ping" });
      // pong 超时 = 连接假死,强制 close → onclose 走重连
      this.#pongTimer = setTimeout(() => this.#ws?.close(), PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  #onPong(): void {
    if (this.#pongTimer) {
      clearTimeout(this.#pongTimer);
      this.#pongTimer = null;
    }
  }

  #clearHeartbeat(): void {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
    if (this.#pongTimer) {
      clearTimeout(this.#pongTimer);
      this.#pongTimer = null;
    }
  }

  #teardownSocket(): void {
    this.#clearHeartbeat();
    const ws = this.#ws;
    if (!ws) return;
    // 主动拆 socket(reconnect/close)前置 false:此处已 null 掉 onclose,不会再回调。
    this.#opts.onStatus?.(false);
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this.#ws = null;
  }
}
