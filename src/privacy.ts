// Only known credentials are redacted. This is not a general source-code secret scanner.
export class Secrets {
  private values = new Set<string>();
  add(value: string): void { if (value.length >= 4) this.values.add(value); }
  redact(text: string): string {
    for (const value of [...this.values].sort((a, b) => b.length - a.length)) text = text.split(value).join('[REDACTED]');
    return text;
  }
  stream(emit: (text: string) => void): { write(text: string): void; flush(): void } {
    let pending = '';
    return {
      write: text => {
        pending += text;
        let cut = Math.max(0, pending.length - Math.max(1, ...[...this.values].map(value => value.length)) + 1);
        for (const value of this.values) {
          let start = pending.indexOf(value);
          while (start !== -1) {
            if (start < cut && start + value.length > cut) cut = start;
            start = pending.indexOf(value, start + 1);
          }
        }
        if (cut) emit(this.redact(pending.slice(0, cut)));
        pending = pending.slice(cut);
      },
      flush: () => { if (pending) emit(this.redact(pending)); pending = ''; },
    };
  }
}

export function terminalText(text: string): string {
  // Provider/tool output is untrusted terminal data. Strip escape/control bytes,
  // including OSC clipboard sequences; preserve ordinary line breaks and tabs.
  return text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
