import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, render, useInput, useStdout, type Instance } from 'ink';
import { EventEmitter } from 'node:events';
import { Secrets, terminalText } from '../privacy.js';

export interface Choice { value: string; label: string; detail?: string }
type Prompt = { label: string; hidden: boolean; choices?: Choice[] };
interface State { lines: string[]; prompt?: Prompt; workspace: string; route: string; accounts: number; session: string; mode?: string; tasks?: string; workers?: number }
const green = '#b5ef63';

export class Terminal {
  readonly rl = new EventEmitter();
  private events = new EventEmitter();
  private state: State = { lines: [], workspace: '', route: 'Choose a model', accounts: 0, session: 'New task' };
  private instance: Instance;
  private pending?: { resolve(value: string): void; reject(error: Error): void; cleanup(): void };
  private closed = false;
  private streaming = false;
  constructor(private readonly secrets: Secrets) {
    this.instance = render(<Screen terminal={this}/>, { alternateScreen: true, exitOnCtrlC: false, patchConsole: false });
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.events.on('change', listener); return () => { this.events.off('change', listener); }; };
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.events.emit('change'); }
  private clean(text: string) { return terminalText(this.secrets.redact(text)); }
  setContext(context: Omit<State, 'lines' | 'prompt'>) { this.update({ ...context, workspace: this.clean(context.workspace), route: this.clean(context.route) }); }
  line(text: string) { this.streaming = false; this.update({ lines: [...this.state.lines, ...this.clean(text).split('\n')].slice(-3000) }); }
  text(text: string) {
    const lines = [...this.state.lines];
    if (!this.streaming) { lines.push('ASSISTANT', ''); this.streaming = true; }
    const last = lines.pop() ?? '';
    this.update({ lines: [...lines, ...(last + this.clean(text)).split('\n')].slice(-3000) });
  }
  question(label: string, signal?: AbortSignal): Promise<string> { return this.ask({ label: this.clean(label).trim(), hidden: false }, signal); }
  password(name: string): Promise<string> { return this.ask({ label: `${name} credential · hidden`, hidden: true }); }
  select(label: string, choices: Choice[]): Promise<string> {
    return this.ask({ label: this.clean(label), hidden: false, choices: choices.map(c => ({ ...c, label: this.clean(c.label), detail: this.clean(c.detail ?? '') })) });
  }
  private ask(prompt: Prompt, signal?: AbortSignal): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Terminal closed.'));
    signal?.throwIfAborted();
    this.streaming = false;
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel('Cancelled.');
      this.pending = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      this.update({ prompt });
    });
  }
  submit(value: string) {
    const pending = this.pending;
    if (!pending) return;
    const prompt = this.state.prompt;
    this.pending = undefined; pending.cleanup();
    if (!prompt?.hidden && !prompt?.choices) this.line(`› ${value}`);
    this.update({ prompt: undefined }); pending.resolve(value);
  }
  cancel(reason = 'Selection cancelled.') {
    const pending = this.pending; this.pending = undefined;
    pending?.cleanup(); this.update({ prompt: undefined }); pending?.reject(new Error(reason));
  }
  interrupt() { this.rl.emit('SIGINT'); }
  close() { if (this.closed) return; this.closed = true; this.cancel('Terminal closed.'); this.instance.unmount(); }
}

export function filterChoices(choices: Choice[], query: string): Choice[] {
  return choices.filter(c => `${c.label} ${c.value} ${c.detail ?? ''}`.toLowerCase().includes(query.toLowerCase()));
}

function Screen({ terminal }: { terminal: Terminal }) {
  const state = useSyncExternalStore(terminal.subscribe, terminal.snapshot);
  const { stdout } = useStdout();
  const [size, resize] = useState({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [scroll, setScroll] = useState(0);
  useEffect(() => { const listener = () => resize({ columns: stdout.columns || 80, rows: stdout.rows || 24 }); stdout.on('resize', listener); return () => { stdout.off('resize', listener); }; }, [stdout]);
  useEffect(() => { setInput(''); setCursor(0); setSelected(0); setScroll(0); }, [state.prompt]);
  const choices = state.prompt?.choices ? filterChoices(state.prompt.choices, input) : undefined;
  useInput((text, key) => {
    if (key.ctrl && text === 'c') { terminal.interrupt(); return; }
    if (key.pageUp) { setScroll(s => s + 5); return; }
    if (key.pageDown) { setScroll(s => Math.max(0, s - 5)); return; }
    if (!state.prompt) return;
    if (key.escape) { if (state.prompt.choices || state.prompt.hidden) terminal.cancel(); else { setInput(''); setCursor(0); } return; }
    if (key.return) { if (choices) { const choice = choices[Math.min(selected, choices.length - 1)]; if (choice) terminal.submit(choice.value); } else terminal.submit(input); return; }
    if (choices && key.upArrow) { setSelected(i => Math.max(0, i - 1)); return; }
    if (choices && key.downArrow) { setSelected(i => Math.min((choices.length || 1) - 1, i + 1)); return; }
    if (key.leftArrow) { setCursor(i => Math.max(0, i - 1)); return; }
    if (key.rightArrow) { setCursor(i => Math.min(input.length, i + 1)); return; }
    if (key.backspace || key.delete) { if (cursor > 0) { setInput(input.slice(0, cursor - 1) + input.slice(cursor)); setCursor(cursor - 1); } return; }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.tab) return;
    const clean = terminalText(text).replace(/[\r\n\t]/g, '');
    setInput(input.slice(0, cursor) + clean + input.slice(cursor)); setCursor(cursor + clean.length); setSelected(0);
  });
  const wide = size.columns >= 110;
  const contentWidth = Math.max(12, size.columns - (wide ? 35 : 6));
  const wrapped = state.lines.flatMap(line => { const chars = [...line]; const result: string[] = []; do { result.push(chars.splice(0, contentWidth).join('')); } while (chars.length); return result; });
  const transcriptHeight = Math.max(2, size.rows - (choices ? 17 : 10));
  const end = Math.max(transcriptHeight, wrapped.length - Math.min(scroll, Math.max(0, wrapped.length - transcriptHeight)));
  const visible = wrapped.slice(Math.max(0, end - transcriptHeight), end);
  const choiceIndex = Math.min(selected, Math.max(0, (choices?.length ?? 1) - 1));
  const shownChoices = choices?.slice(Math.max(0, choiceIndex - 3), Math.max(0, choiceIndex - 3) + 5);
  const display = state.prompt?.hidden ? '•'.repeat(input.length) : input;
  const inputStart = Math.max(0, cursor - contentWidth + 5);
  return <Box flexDirection="column" height={Math.max(10, size.rows)} paddingX={1}>
    <Box justifyContent="space-between" borderStyle="single" borderColor="#344336" paddingX={1}>
      <Text bold color={green}>↗ ROBINHOOD <Text color="gray">/ one task, many models</Text></Text><Text color="gray">preview 0.0.1</Text>
    </Box>
    <Box flexGrow={1}>
      <Box flexDirection="column" width={wide ? size.columns - 32 : size.columns - 2} paddingX={1}>
        <Box height={transcriptHeight} flexDirection="column" overflow="hidden">
          {visible.length ? visible.map((line, i) => <Text key={i} color={line.startsWith('›') ? green : undefined}>{line || ' '}</Text>) : <><Text bold color={green}>Your workspace. Your accounts.</Text><Text color="gray">Connect once. Carry the conversation across models.</Text><Text> </Text><Text>/connect  Link an account</Text><Text>/models   Choose a model</Text><Text>/help     Explore commands</Text></>}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor={state.prompt ? green : '#344336'} paddingX={1}>
          <Text color={green}>{state.prompt?.label || 'Working · Ctrl+C to cancel'}</Text>
          {state.prompt && <Text>› {display.slice(inputStart, cursor)}<Text inverse>{display[cursor] || ' '}</Text>{display.slice(cursor + 1, inputStart + contentWidth - 3)}</Text>}
          {shownChoices?.map(choice => <Text key={choice.value} color={choices?.[choiceIndex] === choice ? green : undefined} wrap="truncate">{choices?.[choiceIndex] === choice ? '› ' : '  '}{choice.label} <Text dimColor>{choice.detail}</Text></Text>)}
          {choices && <Text dimColor>{choices.length ? `${choices.length} matches · ↑↓ choose · enter select · esc back` : 'No matches · edit your search'}</Text>}
        </Box>
      </Box>
      {wide && <Box width={29} flexDirection="column" borderStyle="single" borderColor="#344336" paddingX={1}>
        <Text color={green} bold>WORKSPACE</Text><Text wrap="truncate-middle">{state.workspace}</Text><Text> </Text>
        <Text color={green} bold>MODEL</Text><Text>{state.route}</Text><Text> </Text>
        <Text color={green} bold>ACCOUNTS</Text><Text>{state.accounts} connected · /accounts</Text><Text dimColor>Remaining tokens: unknown</Text><Text> </Text>
        <Text color={green} bold>MEMORY</Text><Text wrap="truncate">{state.session}</Text><Text dimColor>Saved locally · /memory</Text>
        <Text> </Text><Text color={green} bold>{state.mode ?? 'EXECUTE'}</Text><Text>{state.tasks ?? 'No checklist'} · {state.workers ?? 0} workers</Text><Text dimColor>/plan · /todos · /jobs</Text>
      </Box>}
    </Box>
    <Text dimColor> {state.mode ?? 'EXECUTE'} · {state.accounts} accounts · {wide ? 'Approvals stay in your control' : state.route} · PgUp/PgDn scroll · /help</Text>
  </Box>;
}
