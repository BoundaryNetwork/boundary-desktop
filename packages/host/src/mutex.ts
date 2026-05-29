/** 极简串行锁：把异步操作排成单链，保证 Registry 的状态机变更不并发交错。
 *  前一个操作无论成功失败，后一个都接着跑（失败只影响该操作自身的调用方）。 */
export class Mutex {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(fn, fn);
    this.#tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
