type Fn = (p: any) => void;
export class Bus {
  private map = new Map<string, Fn[]>();
  log: { evt: string; p: any; tick: number }[] = [];
  tick = 0;
  onError: (module: string, e: unknown) => void = () => {};
  on(evt: string, fn: Fn): () => void {
    const l = this.map.get(evt) ?? [];
    l.push(fn); this.map.set(evt, l);
    return () => { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  }
  emit(evt: string, p: any = {}): void {
    this.log.push({ evt, p, tick: this.tick });
    if (this.log.length > 500) this.log.splice(0, 250);
    for (const fn of [...(this.map.get(evt) ?? []), ...(this.map.get('*') ?? [])]) {
      try { fn(evt === '*' ? p : (this.map.get('*')?.includes(fn) ? { evt, ...p } : p)); }
      catch (e) { this.onError('bus:' + evt, e); }
    }
  }
}
