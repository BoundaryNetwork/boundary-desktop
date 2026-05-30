import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { CircleUserRound } from "lucide-react";
import type { UserInfo } from "@boundary-desktop/contract";
import { Icons } from "./icons";

/** 系统设置弹层。两栏:左分类导航(整高固定)+ 右内容列(固定 header + 可滚 body)。
 *  视觉全部走设计系统类 bd-*(壳发布的样式契约),仅 modal 自身布局用内联。
 *  个人信息(账号/昵称/个性化信息 + 退出登录)与通用(主题/运行环境)收在这里。 */

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
        {/* 左侧栏:整高固定,设置标题 + 分类导航 */}
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
              className="bd-btn bd-btn--icon"
              style={closeBtnPos}
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
      <div className="bd-section">基本信息</div>
      <div className="bd-card">
        <Row title="账号" sub="登录账号,不可修改">
          <span style={{ fontSize: "var(--text-3)", color: "var(--fg-2)", fontFamily: "var(--mono)" }}>{account}</span>
        </Row>
        <Row title="昵称" sub="显示名称">
          <input
            className="bd-input"
            style={{ width: 220 }}
            value={nickname}
            placeholder="设置昵称"
            onChange={(e) => setNickname(e.target.value)}
          />
        </Row>
      </div>

      <div className="bd-section">个性化信息</div>
      <div className="bd-card">
        <div style={{ padding: "var(--space-7) var(--space-8)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="bd-desc">偏好、习惯、背景信息等,供助理参考</div>
          <textarea
            className="bd-textarea"
            value={preferences}
            placeholder="例如:我负责一家天猫店,主营家居用品,语气偏正式…"
            onChange={(e) => setPreferences(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-6)" }}>
        <button type="button" className="bd-btn bd-btn--primary" disabled={!dirty} onClick={save}>
          保存
        </button>
      </div>

      <div className="bd-section">账户与安全</div>
      <div className="bd-card">
        <EntryRow title="修改密码" sub="设置新的登录密码" onClick={() => {}} />
        <Row title="退出登录" sub="退出当前账户并返回登录页">
          <button type="button" className="bd-btn bd-btn--danger" onClick={onLogout}>
            <Icons.logout size={15} stroke={1.9} />
            退出登录
          </button>
        </Row>
      </div>
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
      <div className="bd-card">
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
        <Row title="运行环境" sub="模块来源与缓存按环境隔离">
          <span className={`bd-badge${env === "staging" ? " bd-badge--warn" : env === "prod" ? " bd-badge--ok" : ""}`}>
            {env || "—"}
          </span>
        </Row>
      </div>
    </div>
  );
}

// ── 基础件(均渲染 bd-* 类,样式归设计系统) ──────────────────────────

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
  return (
    <button type="button" className={`bd-navitem${active ? " bd-navitem--on" : ""}`} onClick={onClick}>
      <span style={{ display: "inline-flex", flex: "none" }}>{icon}</span>
      {label}
    </button>
  );
}

function Row({ title, sub, children }: { title: string; sub?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="bd-row">
      <div className="bd-row__main">
        <div className="bd-title">{title}</div>
        {sub ? <div className="bd-desc">{sub}</div> : null}
      </div>
      <div style={{ flex: "none" }}>{children}</div>
    </div>
  );
}

function EntryRow({ title, sub, onClick }: { title: string; sub?: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="bd-entry" onClick={onClick}>
      <div className="bd-row__main">
        <div className="bd-title">{title}</div>
        {sub ? <div className="bd-desc">{sub}</div> : null}
      </div>
      <Icons.chevronRight size={16} stroke={1.8} style={{ color: "var(--fg-3)", flex: "none" }} />
    </button>
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
    <div className="bd-segmented">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`bd-seg${o.value === value ? " bd-seg--on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── modal 自身布局(bespoke,内联) ────────────────────────────────────

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

/** header 标题与 body 卡片共用的居中列,使两者左右边界一致。 */
const columnStyle: CSSProperties = {
  width: "100%",
};

const closeBtnPos: CSSProperties = {
  position: "absolute",
  top: "var(--space-6)",
  right: "var(--space-6)",
};
