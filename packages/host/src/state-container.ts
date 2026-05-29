import type { Disposable, ReadableState } from "@boundary-desktop/contract";

/** 把一个 Disposable 绑到某次激活的生命周期上，返回原句柄。Registry 注入给能力层，
 *  使能力发出的订阅（auth/config/network 的 subscribe 等）随 deactivate 自动回收。 */
export type TrackDisposable = <D extends Disposable>(disposable: D) => D;

/** 基座持有的可写可观察状态。对模块只暴露 readonly() 派生出的只读视图（get + subscribe）。
 *  共享状态类能力（auth/config/network/theme）共用此原语：基座 set，模块读快照 + 订阅变化。 */
export class StateContainer<T> {
  #value: T;
  #listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get(): T {
    return this.#value;
  }

  set(value: T): void {
    if (Object.is(value, this.#value)) return;
    this.#value = value;
    for (const listener of [...this.#listeners]) listener(value);
  }

  subscribe(listener: (value: T) => void): Disposable {
    this.#listeners.add(listener);
    return {
      dispose: () => {
        this.#listeners.delete(listener);
      },
    };
  }

  /** 派生只读视图；subscribe 经 track 绑定调用方生命周期，自动回收，模块无需手动退订。 */
  readonly(track: TrackDisposable): ReadableState<T> {
    return {
      get: () => this.get(),
      subscribe: (listener) => track(this.subscribe(listener)),
    };
  }
}
