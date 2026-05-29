import { type FormEvent, useState } from "react";

/** 登录页:左侧品牌区 + 右侧表单。提交经 hostApi.auth.submitLogin → main 校验 →
 *  成功后 main 推送 auth:changed,App 自动切到 Shell。 */
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
    <div className="login">
      <aside className="login__brand">
        <h1 className="login__brand-title">达比AI</h1>
        <p className="login__brand-sub">AI 时代的数字员工团队</p>
        <p className="login__brand-tagline">让 AI 触手可及，智能创造无限可能</p>
        <ul className="login__features">
          <li>智能协作</li>
          <li>自动化执行</li>
          <li>数据安全</li>
          <li>持续进化</li>
        </ul>
      </aside>

      <section className="login__panel">
        <div className="login__logo">达比AI</div>
        <p className="login__panel-sub">开启您的数字员工团队</p>

        <form className="login__form" onSubmit={onSubmit}>
          <label className="login__label">
            手机号
            <input
              className="login__input"
              type="tel"
              value={phone}
              placeholder="13800000002"
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
          </label>
          <label className="login__label">
            密码
            <input
              className="login__input"
              type="password"
              value={password}
              placeholder="请输入密码"
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="login__remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            记住密码
          </label>

          {error && <p className="login__error">{error}</p>}

          <button className="login__submit" type="submit" disabled={busy}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </section>
    </div>
  );
}
