/**
 * The command-line main menu. Output lines support inline clickable commands written as
 * {command} or {label|command}. Long-running commands (invite/join) get an AbortSignal and can
 * be cancelled with Esc, Ctrl+C or `cancel`.
 */

export interface Command {
  name: string;
  aliases?: string[];
  usage?: string;
  desc: string;
  hidden?: boolean;
  run(args: string[], t: Terminal, signal: AbortSignal): void | Promise<void>;
}

export type LineStyle = 'out' | 'dim' | 'bright' | 'err' | 'ok' | 'title' | 'echo' | 'big';

export class Terminal {
  private commands = new Map<string, Command>();
  private history: string[] = [];
  private histIdx = -1;
  private task: AbortController | null = null;
  promptText = 'guest@sssnake:~$';
  private bootTimer: number | null = null;
  private onAnyKey: (() => void) | null = null;
  /** While a task runs, it may take commands of its own (e.g. `start` in an invite lobby). */
  taskInput: ((key: string, args: string[]) => boolean) | null = null;

  constructor(
    private out: HTMLElement,
    private input: HTMLInputElement,
    form: HTMLFormElement,
    private prompt: HTMLElement,
    private chips: HTMLElement,
    commands: Command[],
  ) {
    for (const c of commands) {
      this.commands.set(c.name, c);
      for (const a of c.aliases ?? []) this.commands.set(a, c);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const line = input.value;
      input.value = '';
      void this.exec(line, true);
    });
    input.addEventListener('keydown', (e) => this.onKey(e));
    out.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      if (el) void this.exec(el.dataset.cmd!, true);
      else this.focus();
    });
    this.setPrompt(this.promptText);
  }

  get list(): Command[] {
    return [...new Set(this.commands.values())];
  }

  get busy(): boolean {
    return this.task !== null;
  }

  setPrompt(text: string) {
    this.promptText = text;
    this.prompt.textContent = text;
  }

  focus() {
    // Don't pop the on-screen keyboard on phones unless asked.
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus({ preventScroll: true });
  }

  clear() {
    this.out.innerHTML = '';
  }

  /** Print a line. `{cmd}` / `{label|cmd}` become clickable commands. */
  print(text = '', style: LineStyle = 'out'): void {
    const line = document.createElement('div');
    line.className = `tl tl-${style}`;
    const re = /\{([^}|]+)(?:\|([^}]+))?\}/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) line.append(text.slice(last, m.index));
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'tl-cmd';
      a.textContent = m[1];
      a.dataset.cmd = m[2] ?? m[1];
      line.append(a);
      last = re.lastIndex;
    }
    if (last < text.length) line.append(text.slice(last));
    if (!text) line.innerHTML = '&nbsp;';
    this.out.appendChild(line);
    while (this.out.childElementCount > 400) this.out.firstElementChild?.remove();
    this.out.scrollTop = this.out.scrollHeight;

  }

  /** Fixed-width table. */
  table(rows: string[][], style: LineStyle = 'out') {
    const widths: number[] = [];
    for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, c.length)));
    for (const r of rows) this.print(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  '), style);
  }

  setChips(items: { label: string; cmd: string; fill?: boolean }[]) {
    this.chips.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-cmd';
      b.textContent = it.label;
      b.addEventListener('click', () => {
        if (it.fill) {
          this.input.value = `${it.cmd} `;
          this.input.focus();
        } else void this.exec(it.cmd, true);
      });
      this.chips.appendChild(b);
    }
  }

  cancel() {
    if (this.task) {
      this.task.abort();
      this.task = null;
      this.print('^C', 'dim');
    }
  }

  async exec(raw: string, echo: boolean) {
    this.skipBoot();
    const line = raw.trim();
    if (echo) this.print(`${this.promptText} ${line}`, 'echo');
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    this.histIdx = -1;
    const [name, ...args] = line.split(/\s+/);
    const key = name.toLowerCase();
    if (key === 'cancel') {
      if (this.task) this.cancel();
      else this.print('nothing to cancel.', 'dim');
      return;
    }
    if (this.task) {
      if (this.taskInput?.(key, args)) return;
      this.print('busy. type {cancel} first.', 'err');
      return;
    }
    const cmd = this.commands.get(key);
    if (!cmd) {
      const close = this.suggest(key);
      this.print(`${key}: command not found${close ? `. did you mean {${close}}?` : ''}`, 'err');
      return;
    }
    const ctrl = new AbortController();
    const result = cmd.run(args, this, ctrl.signal);
    if (result instanceof Promise) {
      this.task = ctrl;
      try {
        await result;
      } catch (err) {
        if (!ctrl.signal.aborted) this.print(`error: ${(err as Error).message}`, 'err');
      } finally {
        if (this.task === ctrl) this.task = null;
      }
    }
  }

  private suggest(word: string): string | null {
    let best: string | null = null;
    let bestD = 3;
    for (const name of this.commands.keys()) {
      const d = distance(word, name);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  private onKey(e: KeyboardEvent) {
    if (this.onAnyKey) this.onAnyKey();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.history.length) return;
      e.preventDefault();
      if (this.histIdx < 0) this.histIdx = this.history.length;
      this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      this.input.value = this.history[this.histIdx] ?? '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const v = this.input.value.trimStart().toLowerCase();
      if (!v || v.includes(' ')) return;
      const matches = [...this.commands.keys()].filter((n) => n.startsWith(v) && !this.commands.get(n)!.hidden);
      if (matches.length === 1) this.input.value = `${matches[0]} `;
      else if (matches.length > 1) this.print(matches.join('  '), 'dim');
    } else if (e.key === 'Escape' || (e.key === 'c' && e.ctrlKey && !this.input.selectionStart)) {
      if (this.task) {
        e.preventDefault();
        this.cancel();
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.clear();
    }
  }

  /** Type out boot lines; any key or click skips. */
  boot(lines: [string, LineStyle][], fast: boolean, done: () => void) {
    if (fast) {
      for (const [t, s] of lines) this.print(t, s);
      done();
      return;
    }
    let i = 0;
    const finish = () => {
      if (this.bootTimer !== null) window.clearTimeout(this.bootTimer);
      this.bootTimer = null;
      this.onAnyKey = null;
      for (; i < lines.length; i++) this.print(lines[i][0], lines[i][1]);
      done();
    };
    this.onAnyKey = finish;
    this.skipBootFn = finish;
    const next = () => {
      if (i >= lines.length) return finish();
      this.print(lines[i][0], lines[i][1]);
      i++;
      this.bootTimer = window.setTimeout(next, 70 + Math.random() * 90);
    };
    next();
  }

  private skipBootFn: (() => void) | null = null;
  private skipBoot() {
    if (this.bootTimer !== null && this.skipBootFn) this.skipBootFn();
  }
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
