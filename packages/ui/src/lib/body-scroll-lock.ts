const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();

/** Keep overlapping dialogs from restoring each other's temporary scroll lock. */
export function lockBodyScroll(): () => void {
  const body = document.body;
  const lock = locks.get(body) ?? { count: 0, overflow: body.style.overflow };
  lock.count += 1;
  locks.set(body, lock);
  body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count -= 1;
    if (lock.count === 0) {
      body.style.overflow = lock.overflow;
      locks.delete(body);
    }
  };
}
