export function sessionKeyFor(code: string): string {
  return `session:${code}`;
}

export function historyKeyFor(code: string): string {
  return `history:${code}`;
}
