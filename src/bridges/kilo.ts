import { engineConfig, freeEngineModels, StructuredServerBridge } from './opencode.js';
import { ServerProcess, type Engine } from './server-process.js';

export const KILO_VERSION = '7.7.2';
export function kiloConfig() {
  const model = 'kilo/liquid/lfm-2.5-2.6b:free';
  return { ...engineConfig(), enabled_providers: ['kilo'], provider: {}, model, small_model: model };
}
export class KiloProcess extends ServerProcess {
  constructor(config: unknown = kiloConfig()) {
    super(config, { packageName: '@kilocode/cli', version: KILO_VERSION, bin: 'kilo', envPrefix: 'KILO', directoryHeader: 'x-kilo-directory', nodeLauncher: true,
      extraEnv: { KILO_DISABLE_CLAUDE_CODE: 'true', KILO_DISABLE_EXTERNAL_SKILLS: 'true', KILO_SESSION_RETRY_LIMIT: '1', KILO_DISABLE_EMBEDDED_WEB_UI: 'true' },
    });
  }
}
export const kiloModels = (data: unknown) => freeEngineModels(data, 'kilo', id => id.endsWith(':free') && !/(?:^|\/)auto(?:[/:\-]|$)/.test(id));
export class KiloBridge extends StructuredServerBridge {
  constructor(factory: () => Engine = () => new KiloProcess()) {
    super({ id: 'kilo-cli', providerID: 'kilo', label: 'Kilo CLI', models: kiloModels,
      notice: 'Kilo CLI anonymous free-model bridge. Promotional models may retain prompts; use public, non-confidential data only. Remaining allowance is unknown. Internal engine retries are bounded by a two-minute deadline. No paid credentials are imported.',
    }, factory);
  }
}
