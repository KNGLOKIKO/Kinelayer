let counter = 0;

/** 浏览器与 Node 均可用的短 id；不依赖 crypto.randomUUID 的可用性 */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 0xffffff;
  const rand = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}${prefix ? '_' : ''}${t}${counter.toString(36)}${rand}`.slice(0, 26);
}

export function commandId(): string {
  return uid('cmd');
}

export function hostId(): string {
  return uid('host');
}

export function now(): number {
  return Date.now();
}
