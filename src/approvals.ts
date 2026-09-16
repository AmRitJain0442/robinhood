export type ApprovalMode = 'yolo' | 'ask';

export class Approvals {
  constructor(
    public mode: ApprovalMode = 'yolo',
    private readonly question: (description: string, signal: AbortSignal) => Promise<string>,
    private readonly record: (decision: { mode: ApprovalMode; description: string; allowed: boolean }) => void = () => {},
  ) {}
  async confirm(description: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const mode = this.mode;
    const allowed = mode === 'yolo' || (await this.question(description, signal)).trim().toLowerCase() === 'y';
    signal.throwIfAborted();
    this.record({ mode, description, allowed });
    return allowed;
  }
}

export function approvalInstructions(mode: ApprovalMode): string {
  return mode === 'yolo'
    ? 'YOLO mode: runtime permissions are pre-authorized for the user-requested task. Execute available tools without asking for permission or approval. Ask only for missing information needed to do the work. Stay within the user\'s task: this is not authorization for unrelated communications, purchases, publication, or destructive work. Existing plan-mode, credential, workspace, pricing and uncertain-outcome checks still apply.'
    : 'Ask mode: the runtime requests confirmation for tools and account-dependent model requests. Do not duplicate those prompts in conversation.';
}
