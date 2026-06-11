import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import type { Conversation } from "../state/conversation";
import { useConversationStore } from "../state/conversation";
import { useConvStreamStore, historyMessageToLocal } from "../state/stream";
import type {
  ConversationSummary,
  ConversationHistoryResponse,
  ListInstancesResponse,
  UserMessage,
  WsClientRequest,
} from "../types";

const HISTORY_LIMIT = 50;

/** 会话级历史分页游标(MVP 用 REST 拉历史)。 */
const pageCursors = new Map<string, { hasMore: boolean; before?: string }>();

// ─── agent 实例路由 ───────────────────────────────────────────────────────────────
// worker 多实例:会话端点靠 agent_instance_id 路由。worker 无默认实例时该字段必填
// (否则 GET /api/conversations 等 400)。MVP 解析单个实例(default 优先,否则取首个),
// 横切进所有会话级 REST query / body 与 WS 帧。
let instanceId: string | null | undefined; // undefined=未解析;null=无实例(让 worker 走默认)
let ensuring: Promise<void> | null = null;

/** 解析并记忆 agent 实例 id。首调拉 /api/instances;失败可重试(不缓存失败)。 */
export async function ensureInstance(ctx: RendererContext): Promise<void> {
  if (instanceId !== undefined) return;
  if (!ensuring) {
    ensuring = ctx.api
      .request<ListInstancesResponse>({ method: "GET", path: "/api/instances" })
      .then((res) => {
        instanceId = res.default_instance_id ?? res.instances?.[0]?.agent_instance_id ?? null;
      })
      .finally(() => {
        ensuring = null;
      });
  }
  return ensuring;
}

/** 切活化时清解析态:reactivate 后按新 worker 重新解析。 */
export function resetInstance(): void {
  instanceId = undefined;
  ensuring = null;
}

/** 会话级 REST query 注入 agent_instance_id(已解析且非空时)。 */
function routedQuery(base?: Record<string, string | number>): Record<string, string | number> | undefined {
  if (!instanceId) return base;
  return { ...base, agent_instance_id: instanceId };
}

/** WS 帧注入 agent_instance_id(已解析且非空时)。 */
function routedFrame<T extends WsClientRequest>(frame: T): T {
  return instanceId ? { ...frame, agent_instance_id: instanceId } : frame;
}

function toConversation(w: ConversationSummary): Conversation {
  return { id: w.conversation_id, name: w.name, lastTurnAt: w.last_turn_at };
}

// ─── REST ──────────────────────────────────────────────────────────────────────

export async function listConversations(ctx: RendererContext): Promise<Conversation[]> {
  const res = await ctx.api.request<{ conversations?: ConversationSummary[] }>({
    method: "GET",
    path: "/api/conversations",
    query: routedQuery(),
  });
  return (res.conversations ?? []).map(toConversation);
}

export async function createConversation(ctx: RendererContext, name?: string): Promise<Conversation> {
  const res = await ctx.api.request<{ conversation_id: string; name?: string }>({
    method: "POST",
    path: "/api/conversations",
    body: { ...(name ? { name } : {}), ...(instanceId ? { agent_instance_id: instanceId } : {}) },
  });
  return { id: res.conversation_id, name: res.name, lastTurnAt: null };
}

export async function renameConversation(ctx: RendererContext, id: string, name: string): Promise<void> {
  await ctx.api.request({
    method: "POST",
    path: `/api/conversations/${id}/rename`,
    query: routedQuery(),
    body: { name },
  });
}

export async function deleteConversationApi(ctx: RendererContext, id: string): Promise<void> {
  await ctx.api.request({ method: "DELETE", path: `/api/conversations/${id}`, query: routedQuery() });
}

async function fetchHistory(
  ctx: RendererContext,
  id: string,
  before?: string,
): Promise<ConversationHistoryResponse> {
  return ctx.api.request<ConversationHistoryResponse>({
    method: "GET",
    path: `/api/conversations/${id}/history`,
    query: routedQuery(before ? { limit: HISTORY_LIMIT, before } : { limit: HISTORY_LIMIT }),
  });
}

// ─── WS 发送 ─────────────────────────────────────────────────────────────────────

export function subscribe(ws: ChatWs, id: string): void {
  ws.send(routedFrame({ type: "subscribe_conversation", conversation_id: id }));
}
export function unsubscribe(ws: ChatWs, id: string): void {
  ws.send(routedFrame({ type: "unsubscribe_conversation", conversation_id: id }));
}
export function sendTurn(ws: ChatWs, id: string, message: string): void {
  ws.send(routedFrame({ type: "turn", conversation_id: id, message, stream: true }));
}
export function stopTurn(ws: ChatWs, id: string): void {
  ws.send(routedFrame({ type: "stop_turn", conversation_id: id }));
}

// ─── 编排 ─────────────────────────────────────────────────────────────────────────

/** 选择会话:退订旧、置 currentId、首次进入则拉历史 seed、订阅。返回 hasMore 供 UI。 */
export async function selectConversation(ctx: RendererContext, ws: ChatWs, id: string): Promise<boolean> {
  await ensureInstance(ctx); // 订阅/历史都要 agent_instance_id
  const conv = useConversationStore.getState();
  const prevId = conv.currentId;
  if (prevId && prevId !== id) unsubscribe(ws, prevId);
  conv.setCurrentId(id);

  // 已有 stream entry 则不重拉(R-3 方案 A)
  if (!useConvStreamStore.getState().byConversation[id]) {
    const res = await fetchHistory(ctx, id);
    const msgs = (res.messages ?? []).map((m) => historyMessageToLocal(m, id));
    useConvStreamStore.getState().seedHistory(id, msgs);
    pageCursors.set(id, { hasMore: res.has_more, before: res.next_before });
  }
  subscribe(ws, id);
  return pageCursors.get(id)?.hasMore ?? false;
}

/** 加载更早一页历史(prepend)。返回剩余 hasMore。 */
export async function loadOlder(ctx: RendererContext, id: string): Promise<boolean> {
  await ensureInstance(ctx);
  const cur = pageCursors.get(id);
  if (!cur || !cur.hasMore || !cur.before) return false;
  const res = await fetchHistory(ctx, id, cur.before);
  const older = (res.messages ?? []).map((m) => historyMessageToLocal(m, id));
  useConvStreamStore.getState().prependHistory(id, older);
  pageCursors.set(id, { hasMore: res.has_more, before: res.next_before });
  return res.has_more;
}

/** 新建会话:create → upsert 列表 → select。返回新会话。 */
export async function newConversation(ctx: RendererContext, ws: ChatWs): Promise<Conversation> {
  await ensureInstance(ctx);
  const conv = await createConversation(ctx);
  useConversationStore.getState().upsert(conv);
  await selectConversation(ctx, ws, conv.id);
  return conv;
}

/** 删除会话:REST 删 → 退订 → 清 stream entry → 清列表。 */
export async function removeConversation(ctx: RendererContext, ws: ChatWs, id: string): Promise<void> {
  await ensureInstance(ctx);
  await deleteConversationApi(ctx, id);
  unsubscribe(ws, id);
  useConvStreamStore.getState().clearByConversation(id);
  useConversationStore.getState().remove(id);
  pageCursors.delete(id);
}

/** 发送:乐观追加 user 消息 → WS turn。 */
export function send(ws: ChatWs, id: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const local: UserMessage = {
    messageId: `local-${crypto.randomUUID()}`,
    conversationId: id,
    role: "user",
    content: t,
    timestamp: new Date().toISOString(),
  };
  useConvStreamStore.getState().appendLocal(id, local);
  sendTurn(ws, id, t);
}

/** 外部 tool(chat.ask)入口:无当前会话则新建,再发送。 */
export async function ask(ctx: RendererContext, ws: ChatWs, q: string): Promise<void> {
  await ensureInstance(ctx); // 已有会话直接 send 时也需 instanceId 就绪
  let id = useConversationStore.getState().currentId;
  if (!id) {
    const c = await newConversation(ctx, ws);
    id = c.id;
  }
  send(ws, id, q);
}
