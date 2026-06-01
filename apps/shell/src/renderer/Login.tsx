import { type CSSProperties, type FormEvent, useState } from "react";
import { KeyRound, Smartphone } from "lucide-react";
import { BrandMark } from "./components/BrandMark";
import { TrafficLights } from "./components/TrafficLights";

/** 登录页:左侧产品展示(cover.png)+ 右侧账户表单。视觉严格参照 openclaw-desktop。
 *  提交经 hostApi.auth.submitLogin → main 校验 → 成功后 main 推 auth:changed,
 *  App 自动切到 Shell。 */
export function Login(): JSX.Element {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await window.hostApi.auth.submitLogin(phone, password);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "登录失败");
  }

  return (
    <div style={screenStyle}>
      {/* 顶部拖窗带 + 自绘红绿灯(无边框窗口) */}
      <div
        className="app-drag"
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 38, zIndex: 1, display: "flex", alignItems: "center", paddingLeft: "var(--space-2)" }}
      >
        <TrafficLights />
      </div>
      <div style={showcaseStyle} />

      <div style={panelStyle}>
        <div style={{ width: 340, maxWidth: "100%" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--space-4)",
              marginBottom: "var(--space-15)",
            }}
          >
            <BrandMark size={83} />
            <div style={{ fontSize: "var(--text-8)", fontWeight: 600, color: "var(--fg-0)" }}>达比AI</div>
            <div style={{ fontSize: "var(--text-3)", color: "var(--fg-2)" }}>开启你的数字员工团队</div>
          </div>

          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
            <Field label="手机号">
              <LoginInput value={phone} onChange={setPhone} placeholder="请输入手机号" inputMode="numeric" autoFocus Icon={Smartphone} />
            </Field>
            <Field label="密码">
              <LoginInput value={password} onChange={setPassword} placeholder="请输入密码" type="password" Icon={KeyRound} />
            </Field>

            <label style={rememberStyle}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              记住密码
            </label>

            {error ? <div style={errorStyle}>{error}</div> : null}

            <button type="submit" disabled={busy} style={{ ...primaryBtnStyle, opacity: busy ? 0.6 : 1 }}>
              {busy ? "登录中…" : "登录"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontSize: "var(--text-4)", color: "var(--fg-1)", fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

function LoginInput({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoFocus,
  Icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  inputMode?: "numeric";
  autoFocus?: boolean;
  Icon: typeof Smartphone;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ ...inputStyle, borderColor: focused ? "var(--accent-ring)" : "var(--line)" }}>
      <Icon size={18} color="var(--fg-3)" style={{ flex: "none" }} />
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          background: "transparent",
          outline: "none",
          padding: 0,
          color: "var(--fg-0)",
          fontFamily: "var(--mono)",
          fontSize: "var(--text-4)",
        }}
      />
    </div>
  );
}

const screenStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg-0)",
  display: "flex",
  zIndex: 200,
};

const showcaseStyle: CSSProperties = {
  flex: "55 1 0",
  minWidth: 0,
  backgroundColor: "#eef3fe",
  backgroundImage: "url(cover.png)",
  backgroundSize: "contain",
  backgroundOrigin: "content-box",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  padding: "var(--space-13)",
  borderRight: "1px solid var(--line-soft)",
  overflow: "hidden",
};

const panelStyle: CSSProperties = {
  flex: "45 1 0",
  minWidth: 0,
  background: "var(--bg-1)",
  display: "grid",
  placeItems: "center",
  padding: "var(--space-10)",
  overflow: "auto",
};

const inputStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-4)",
  background: "var(--bg-1)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-pill)",
  padding: "var(--space-5) var(--space-6)",
  transition: "border-color 120ms",
};

const rememberStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  fontSize: "var(--text-3)",
  color: "var(--fg-2)",
  cursor: "pointer",
  userSelect: "none",
  marginTop: "calc(-1 * var(--space-6))",
};

const errorStyle: CSSProperties = {
  fontSize: "var(--text-4)",
  color: "var(--err)",
  background: "color-mix(in oklch, var(--err) 8%, transparent)",
  border: "1px solid color-mix(in oklch, var(--err) 25%, transparent)",
  borderRadius: "var(--r-3)",
  padding: "var(--space-3) var(--space-5)",
  lineHeight: "var(--lh-5)",
  wordBreak: "break-word",
};

const primaryBtnStyle: CSSProperties = {
  width: "100%",
  padding: "var(--space-5) var(--space-4)",
  border: "none",
  borderRadius: "var(--r-pill)",
  background: "var(--accent)",
  color: "#fff",
  fontSize: "var(--text-4)",
  fontFamily: "inherit",
  cursor: "pointer",
};
