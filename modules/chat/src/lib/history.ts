// 输入历史:从本会话 messages 派生已发送 user 文本 + ↑/↓ 回溯 textarea 的 hook。
// 移植自 agent-ui lib/chat-history.ts + pages/ChatPage/useComposerHistory.ts(剥附件/技能线)。

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../types";

/** 从本会话 messages 派生输入历史,chronological:下标 0 = 最老,末位 = 最新。 */
export function composerHistory(messages: readonly Message[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (!m.content || m.content.trim() === "") continue;
    out.push(m.content);
  }
  return out;
}

export interface UseHistoryArgs {
  taRef: React.RefObject<HTMLTextAreaElement>;
  input: string;
  setInput: (v: string) => void;
  /** 纯文本历史,chronological(下标 0=最老,末位=最新) */
  history: readonly string[];
}

export interface UseHistoryResult {
  /** 返回 true=已消费(调用方 return);false=让 keydown 后续逻辑继续 */
  handleHistoryKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  inBrowseMode: boolean;
  /** current = total - historyIndex;未浏览为 null */
  badge: { current: number; total: number } | null;
  exitBrowseMode: () => void;
}

/**
 * 输入框 ↑/↓ 切换本会话输入历史(纯文本版)。
 * 浏览态:historyIndex===null 未浏览;0 最新;数字越大越老。
 */
export function useComposerHistory({
  taRef,
  input,
  setInput,
  history,
}: UseHistoryArgs): UseHistoryResult {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  // Sentinel:input ≠ this → 用户编辑了 → 退出浏览态。
  const lastNavLoadedRef = useRef<string | null>(null);

  const exitBrowseMode = useCallback((): void => {
    setHistoryIndex(null);
    lastNavLoadedRef.current = null;
  }, []);

  // 编辑即退出:浏览态下 input 偏离上次载入的历史文本 → 退出。
  useEffect(() => {
    if (historyIndex === null) return;
    if (input === lastNavLoadedRef.current) return;
    exitBrowseMode();
  }, [input, historyIndex, exitBrowseMode]);

  const handleHistoryKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (e.nativeEvent.isComposing) return false;
      if (e.shiftKey || e.altKey || e.metaKey) return false;
      let dir: "up" | "down" | null = null;
      if (e.key === "ArrowUp") dir = "up";
      else if (e.key === "ArrowDown") dir = "down";
      else if (e.ctrlKey && (e.key === "p" || e.key === "P")) dir = "up";
      else if (e.ctrlKey && (e.key === "n" || e.key === "N")) dir = "down";
      if (!dir) return false;

      const ta = taRef.current;
      if (!ta) return false;
      const value = ta.value;
      const pos = ta.selectionStart ?? 0;
      const selEnd = ta.selectionEnd ?? 0;
      if (pos !== selEnd) return false;

      const browsing = historyIndex !== null;
      const composerEmpty = value.length === 0;
      // 草稿态保护:Composer 非空时 ↑/↓ 只移光标,绝不进历史。
      if (!browsing && !composerEmpty) return false;

      // 逻辑行边界判定(不管视觉折行)。
      const isFirstLine = !value.slice(0, pos).includes("\n");
      const isLastLine = !value.slice(pos).includes("\n");
      const isLineStart = pos === 0 || value.charAt(pos - 1) === "\n";
      const isLineEnd = pos === value.length || value.charAt(pos) === "\n";
      const atUpperEdge = isFirstLine && isLineStart;
      const atLowerEdge = isLastLine && isLineEnd;
      if (dir === "up" && !atUpperEdge) return false;
      if (dir === "down" && !atLowerEdge) return false;

      e.preventDefault();
      const total = history.length;
      const focusToTop = (): void => {
        requestAnimationFrame(() => {
          const el = taRef.current;
          if (!el) return;
          el.focus();
          el.scrollTop = 0;
          el.setSelectionRange(0, 0);
        });
      };
      const loadEntry = (text: string, idx: number): void => {
        lastNavLoadedRef.current = text;
        setHistoryIndex(idx);
        setInput(text);
        focusToTop();
      };
      if (dir === "up") {
        if (total === 0) return true;
        const nextIdx = historyIndex === null ? 0 : historyIndex + 1;
        if (nextIdx >= total) return true; // 最老不动
        loadEntry(history[total - 1 - nextIdx]!, nextIdx);
        return true;
      }
      // down
      if (historyIndex === null) return true;
      if (historyIndex === 0) {
        lastNavLoadedRef.current = "";
        setHistoryIndex(null);
        setInput("");
        focusToTop();
        return true;
      }
      const nextIdx = historyIndex - 1;
      loadEntry(history[total - 1 - nextIdx]!, nextIdx);
      return true;
    },
    [taRef, setInput, history, historyIndex],
  );

  const inBrowseMode = historyIndex !== null && history.length > 0;
  const badge =
    historyIndex === null
      ? null
      : { current: history.length - historyIndex, total: history.length };

  return { handleHistoryKey, inBrowseMode, badge, exitBrowseMode };
}
