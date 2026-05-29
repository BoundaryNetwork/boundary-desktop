import { useEffect, useRef, useState } from "react";
import type { AuthState } from "@boundary-desktop/contract";
import { Login } from "./Login";
import { Shell } from "./Shell";

/** 登录门:未登录渲染 Login,已登录渲染 Shell。auth 状态由 main 经 IPC 推送。 */
export function App(): JSX.Element {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    const off = window.hostApi.auth.onChange(setAuth);
    void window.hostApi.auth.getState().then((state) => {
      setAuth(state);
      // 未登录则武装 AuthDriver(后续登录表单提交才有待决请求可 resolve)
      if (!state.authenticated && !armed.current) {
        armed.current = true;
        void window.hostApi.auth.requestLogin();
      }
    });
    return off;
  }, []);

  if (!auth) return <div className="boot">启动中…</div>;
  return auth.authenticated && auth.user ? <Shell user={auth.user} /> : <Login />;
}
