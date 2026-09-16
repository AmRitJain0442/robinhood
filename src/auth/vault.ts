export interface SavedAccount { key: string; configuration?: string; method: string }
interface EntryLike { getPassword(): string | null | undefined; setPassword(value: string): void; deletePassword(): unknown }
export type EntryFactory = (service: string, account: string) => EntryLike;

// Separate entries avoid Windows credential-size limits and permit independent unlinking.
export class AccountVault {
  constructor(private readonly entry: EntryFactory, private readonly namespace = 'robinhood.accounts.v1') {}
  async load(provider: string): Promise<SavedAccount | undefined> {
    const raw = this.entry(this.namespace, provider).getPassword();
    if (!raw) return undefined;
    const data = JSON.parse(raw) as SavedAccount;
    if (!data || typeof data.key !== 'string' || typeof data.method !== 'string' || data.configuration !== undefined && typeof data.configuration !== 'string') throw new Error('Saved account is malformed. Reconnect to replace it.');
    return data;
  }
  async save(provider: string, account: SavedAccount): Promise<void> { this.entry(this.namespace, provider).setPassword(JSON.stringify(account)); }
  async remove(provider: string): Promise<void> {
    const entry = this.entry(this.namespace, provider);
    if (entry.getPassword() != null) entry.deletePassword();
  }
}

export async function systemVault(namespace?: string): Promise<AccountVault> {
  const { Entry } = await import('@napi-rs/keyring');
  // Secret Service persists across Linux reboots; keyutils fallback does not.
  return new AccountVault((service, account) => new Entry(service, account, { linux: { store: 'secret-service' } }), namespace);
}
