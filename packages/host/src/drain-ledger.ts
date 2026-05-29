/** 在途调用账本。按 activation token（每次激活的代际）计数在途 tool 调用。
 *
 *  替换/卸载前 Registry 调 drain(token) 等该代际的在途调用清零，再 deactivate。
 *  按 token 而非 module id 计数：热替换期间新旧两代并存，要 drain 的只是旧代，
 *  新代的调用归新 token，互不牵连。 */
export class DrainLedger {
  #counts = new Map<number, number>();
  #waiters = new Map<number, Array<() => void>>();

  enter(token: number): void {
    this.#counts.set(token, (this.#counts.get(token) ?? 0) + 1);
  }

  leave(token: number): void {
    const next = (this.#counts.get(token) ?? 0) - 1;
    if (next > 0) {
      this.#counts.set(token, next);
      return;
    }
    this.#counts.delete(token);
    const waiters = this.#waiters.get(token);
    if (waiters) {
      this.#waiters.delete(token);
      for (const w of waiters) w();
    }
  }

  inFlight(token: number): number {
    return this.#counts.get(token) ?? 0;
  }

  /** 等该 token 的在途调用清零；超时则 reject（明确失败，绝不静默丢弃在途调用）。 */
  async drain(token: number, timeoutMs: number): Promise<void> {
    if (this.inFlight(token) === 0) return;
    await new Promise<void>((resolve, reject) => {
      const waiters = this.#waiters.get(token) ?? [];
      let timer: ReturnType<typeof setTimeout>;
      const onZero = () => {
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        const i = waiters.indexOf(onZero);
        if (i >= 0) waiters.splice(i, 1);
        reject(
          new Error(
            `drain 超时：token ${token} 仍有 ${this.inFlight(token)} 个在途调用未完成`,
          ),
        );
      }, timeoutMs);
      waiters.push(onZero);
      this.#waiters.set(token, waiters);
    });
  }
}
