import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { CircleUserRound } from "lucide-react";
import type { UserInfo } from "@boundary-desktop/contract";
import { Icons } from "./icons";

/** 系统设置弹层。两栏骨架:左分类导航 + 右分组卡片。
 *  个人信息(含退出登录)与通用(主题 / 运行环境)收在这里。
 *  主题切换直接驱动 <html data-theme>,持久化到 localStorage。 */

type Category = "profile" | "general";
type Theme = "light" | "dark";

const THEME_KEY = "boundary.theme";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(t: Theme): void {
  const el = document.documentElement;
  if (t === "dark") el.setAttribute("data-theme", "dark");
  else el.removeAttribute("data-theme");
  localStorage.setItem(THEME_KEY, t);
}

export function SettingsModal({
  open,
  onClose,
  user,
  env,
}: {
  open: boolean;
  onClose: () => void;
  user: UserInfo;
  env: string;
}): JSX.Element | null {
  const [cat, setCat] = useState<Category>("profile");
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const title = cat === "profile" ? "个人信息" : "通用";

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* 左侧栏:整高固定,含设置标题 + 分类导航 */}
        <nav style={navStyle}>
          <div style={navTitleStyle}>设置</div>
          <NavItem
            icon={<CircleUserRound size={18} strokeWidth={1.9} />}
            label="个人信息"
            active={cat === "profile"}
            onClick={() => setCat("profile")}
          />
          <NavItem
            icon={<Icons.gear size={18} stroke={1.9} />}
            label="通用"
            active={cat === "general"}
            onClick={() => setCat("general")}
          />
        </nav>

        {/* 右侧内容列:固定 header(当前页标题 + 关闭) + 可滚 body(隐藏滚动条) */}
        <div style={rightColStyle}>
          <header style={headerStyle}>
            <div style={columnStyle}>
              <div style={headerTitleStyle}>{title}</div>
            </div>
            <button
              type="button"
              aria-label="关闭"
              title="关闭"
              onClick={onClose}
              style={closeBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-3)";
                e.currentTarget.style.color = "var(--fg-0)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--fg-2)";
              }}
            >
              <Icons.x size={18} />
            </button>
          </header>

          <section className="oc-no-scrollbar" style={bodyStyle}>
            {cat === "profile" ? (
              <ProfilePane
                user={user}
                onLogout={() => {
                  onClose();
                  void window.hostApi.auth.requestLogout();
                }}
              />
            ) : null}

            {cat === "general" ? (
              <GeneralPane
                env={env}
                theme={theme}
                onTheme={(t) => {
                  setTheme(t);
                  applyTheme(t);
                }}
              />
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── 分页 ──────────────────────────────────────────────────────────────

/** 本地 profile(昵称 / 个性化信息)。无后端,按账号隔离存 localStorage。 */
type LocalProfile = { nickname: string; preferences: string };

function profileKey(account: string): string {
  return `boundary.profile.${account}`;
}

function loadProfile(account: string, fallbackNickname: string): LocalProfile {
  const raw = localStorage.getItem(profileKey(account));
  if (raw) {
    const p = JSON.parse(raw) as Partial<LocalProfile>;
    return { nickname: p.nickname ?? fallbackNickname, preferences: p.preferences ?? "" };
  }
  return { nickname: fallbackNickname, preferences: "" };
}

function ProfilePane({ user, onLogout }: { user: UserInfo; onLogout: () => void }): JSX.Element {
  const account = user.id;
  const [saved, setSaved] = useState<LocalProfile>(() => loadProfile(account, user.name));
  const [nickname, setNickname] = useState(saved.nickname);
  const [preferences, setPreferences] = useState(saved.preferences);

  const dirty = nickname !== saved.nickname || preferences !== saved.preferences;

  function save(): void {
    const next: LocalProfile = { nickname: nickname.trim(), preferences };
    localStorage.setItem(profileKey(account), JSON.stringify(next));
    setSaved(next);
    setNickname(next.nickname);
  }

  return (
    <div style={columnStyle}>
      <SectionLabel>基本信息</SectionLabel>
      <Group>
        <Row title="账号" sub="登录账号,不可修改">
          <span style={{ fontSize: "var(--text-3)", color: "var(--fg-2)", fontFamily: "var(--mono)" }}>{account}</span>
        </Row>
        <Row title="昵称" sub="显示名称" last>
          <TextInput value={nickname} onChange={setNickname} placeholder="设置昵称" />
        </Row>
      </Group>

      <SectionLabel>个性化信息</SectionLabel>
      <Group>
        <div style={{ padding: "var(--space-7) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ fontSize: "var(--text-2)", color: "var(--fg-2)" }}>
            偏好、习惯、背景信息等,供助理参考
          </div>
          <TextArea value={preferences} onChange={setPreferences} placeholder="例如:我负责一家天猫店,主营家居用品,语气偏正式…" />
        </div>
      </Group>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-6)" }}>
        <PrimaryButton onClick={save} disabled={!dirty}>
          保存
        </PrimaryButton>
      </div>

      <SectionLabel>账户与安全</SectionLabel>
      <Group>
        <EntryRow title="修改密码" sub="设置新的登录密码" onClick={() => {}} />
        <Row title="退出登录" sub="退出当前账户并返回登录页" last>
          <DangerButton onClick={onLogout}>
            <Icons.logout size={15} stroke={1.9} />
            退出登录
          </DangerButton>
        </Row>
      </Group>
    </div>
  );
}

function GeneralPane({
  env,
  theme,
  onTheme,
}: {
  env: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
}): JSX.Element {
  return (
    <div style={columnStyle}>
      <Group>
        <Row title="主题" sub="界面外观">
          <Segmented
            value={theme}
            options={[
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ]}
            onChange={onTheme}
          />
        </Row>
        <Row title="运行环境" sub="模块来源与缓存按环境隔离" last>
          <EnvBadge env={env} />
        </Row>
      </Group>
    </div>
  );
}

// ── 基础件 ────────────────────────────────────────────────────────────

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-5)",
        padding: "var(--space-5) var(--space-6)",
        borderRadius: "var(--r-4)",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "var(--text-4)",
        fontWeight: active ? 600 : 400,
        textAlign: "left",
        background: active ? "var(--accent-soft)" : hovered ? "var(--bg-3)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-1)",
        transition: "background 120ms, color 120ms",
      }}
    >
      <span style={{ display: "inline-flex", flex: "none" }}>{icon}</span>
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        margin: "var(--space-9) 0 var(--space-5)",
        fontSize: "var(--text-4)",
        fontWeight: 600,
        color: "var(--fg-0)",
      }}
    >
      {children}
    </div>
  );
}

function Group({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-5)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function Row({
  title,
  sub,
  last,
  children,
}: {
  title: string;
  sub?: string;
  last?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "var(--space-7) var(--space-8)",
        borderBottom: last ? "none" : "1px solid var(--line-soft)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-4)", color: "var(--fg-0)" }}>{title}</div>
        {sub ? <div style={{ fontSize: "var(--text-2)", color: "var(--fg-2)" }}>{sub}</div> : null}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-1)",
        padding: "var(--space-1)",
        background: "var(--bg-3)",
        borderRadius: "var(--r-pill)",
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              padding: "var(--space-3) var(--space-7)",
              borderRadius: "var(--r-pill)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "var(--text-3)",
              fontWeight: on ? 600 : 400,
              background: on ? "var(--bg-1)" : "transparent",
              color: on ? "var(--fg-0)" : "var(--fg-2)",
              boxShadow: on ? "var(--shadow-1)" : "none",
              transition: "background 120ms, color 120ms",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function EnvBadge({ env }: { env: string }): JSX.Element {
  const label = env || "—";
  const accent = env === "staging" ? "var(--warn)" : env === "prod" ? "var(--ok)" : "var(--accent)";
  return (
    <span
      style={{
        fontSize: "var(--text-2)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "var(--space-2) var(--space-5)",
        borderRadius: "var(--r-pill)",
        color: accent,
        background: `color-mix(in oklch, ${accent} 14%, transparent)`,
        border: `1px solid color-mix(in oklch, ${accent} 30%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

function DangerButton({ onClick, children }: { onClick: () => void; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-4) var(--space-7)",
        borderRadius: "var(--r-3)",
        border: "1px solid color-mix(in oklch, var(--err) 35%, transparent)",
        background: "color-mix(in oklch, var(--err) 8%, transparent)",
        color: "var(--err)",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: "var(--text-3)",
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: 220,
        padding: "var(--space-3) var(--space-5)",
        borderRadius: "var(--r-3)",
        border: `1px solid ${focused ? "var(--accent-ring)" : "var(--line)"}`,
        background: "var(--bg-1)",
        color: "var(--fg-0)",
        fontFamily: "inherit",
        fontSize: "var(--text-3)",
        outline: "none",
        transition: "border-color 120ms",
      }}
    />
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      rows={4}
      style={{
        width: "100%",
        resize: "vertical",
        minHeight: 92,
        padding: "var(--space-5) var(--space-6)",
        borderRadius: "var(--r-3)",
        border: `1px solid ${focused ? "var(--accent-ring)" : "var(--line)"}`,
        background: "var(--bg-1)",
        color: "var(--fg-0)",
        fontFamily: "inherit",
        fontSize: "var(--text-3)",
        lineHeight: "var(--lh-5)",
        outline: "none",
        transition: "border-color 120ms",
      }}
    />
  );
}

function EntryRow({
  title,
  sub,
  onClick,
}: {
  title: string;
  sub?: string;
  onClick: () => void;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        width: "100%",
        padding: "var(--space-7) var(--space-8)",
        background: hovered ? "var(--bg-3)" : "transparent",
        border: "none",
        borderBottom: "1px solid var(--line-soft)",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "background 120ms",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-4)", color: "var(--fg-0)" }}>{title}</div>
        {sub ? <div style={{ fontSize: "var(--text-2)", color: "var(--fg-2)" }}>{sub}</div> : null}
      </div>
      <Icons.chevronRight size={16} stroke={1.8} style={{ color: "var(--fg-3)", flex: "none" }} />
    </button>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "var(--space-4) var(--space-9)",
        borderRadius: "var(--r-3)",
        border: "none",
        background: "var(--accent)",
        color: "#fff",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        fontSize: "var(--text-3)",
        fontWeight: 500,
        transition: "opacity 120ms",
      }}
    >
      {children}
    </button>
  );
}

// ── 样式 ──────────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 300,
  background: "var(--overlay-2)",
  display: "grid",
  placeItems: "center",
  padding: "var(--space-10)",
};

const modalStyle: CSSProperties = {
  width: 880,
  maxWidth: "100%",
  height: 600,
  maxHeight: "85vh",
  display: "grid",
  gridTemplateColumns: "212px 1fr",
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-7)",
  boxShadow: "var(--shadow-4)",
  overflow: "hidden",
};

const navStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-8) var(--space-5)",
  background: "var(--bg-mid)",
  borderRight: "1px solid var(--line)",
};

const navTitleStyle: CSSProperties = {
  fontSize: "var(--text-6)",
  fontWeight: 700,
  color: "var(--fg-0)",
  padding: "var(--space-2) var(--space-6) var(--space-8)",
};

const rightColStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  flex: "none",
  position: "relative",
  padding: "var(--space-8) var(--space-9) var(--space-7)",
};

const headerTitleStyle: CSSProperties = {
  fontSize: "var(--text-7)",
  fontWeight: 700,
  color: "var(--fg-0)",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  padding: "var(--space-2) var(--space-9) var(--space-12)",
};

/** 右列内容列:header 标题与 body 卡片共用,使两者左右边界一致。 */
const columnStyle: CSSProperties = {
  width: "100%",
};

const closeBtnStyle: CSSProperties = {
  position: "absolute",
  top: "var(--space-6)",
  right: "var(--space-6)",
  width: 32,
  height: 32,
  display: "inline-grid",
  placeItems: "center",
  borderRadius: "var(--r-3)",
  border: "none",
  background: "transparent",
  color: "var(--fg-2)",
  cursor: "pointer",
  transition: "background 120ms, color 120ms",
};
