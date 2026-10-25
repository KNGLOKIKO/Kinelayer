import { create } from 'zustand';
import { decryptString, encryptString } from './crypto';
import { lsGet, lsRemove, lsSet } from '@/persist/storage';

export interface AIConfig {
  baseUrl: string;
  model: string;
  requireConfirm: boolean;
  demoMode: boolean;
  temperature: number;
}

const CONFIG_KEY = 'ai.config';
const SECRET_KEY = 'ai.key';

const DEFAULT_CONFIG: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  requireConfirm: true,
  demoMode: true,
  temperature: 0.4,
};

interface AIStoreState {
  config: AIConfig;
  apiKey: string;
  hasKey: boolean;
  loaded: boolean;
  testState: 'idle' | 'loading' | 'ok' | 'fail';
  testMessage: string;
}

export const useAIStore = create<AIStoreState>(() => ({
  config: DEFAULT_CONFIG,
  apiKey: '',
  hasKey: false,
  loaded: false,
  testState: 'idle',
  testMessage: '',
}));

export async function initAI(): Promise<void> {
  let config = DEFAULT_CONFIG;
  try {
    const raw = lsGet(CONFIG_KEY);
    if (raw) config = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) };
  } catch {
    /* 用默认值 */
  }
  const cipher = lsGet(SECRET_KEY) ?? '';
  const apiKey = cipher ? await decryptString(cipher) : '';
  useAIStore.setState({ config, apiKey, hasKey: !!apiKey, loaded: true });
}

export async function saveAI(patch: Partial<AIConfig> & { apiKey?: string }): Promise<void> {
  const state = useAIStore.getState();
  const { apiKey, ...rest } = patch;
  const config: AIConfig = { ...state.config, ...rest };
  lsSet(CONFIG_KEY, JSON.stringify(config));
  let nextKey = state.apiKey;
  if (apiKey !== undefined) {
    nextKey = apiKey;
    if (apiKey) lsSet(SECRET_KEY, await encryptString(apiKey));
    else lsRemove(SECRET_KEY);
  }
  useAIStore.setState({ config, apiKey: nextKey, hasKey: !!nextKey, testState: 'idle', testMessage: '' });
}

export async function testAI(): Promise<boolean> {
  const { config, apiKey, hasKey } = useAIStore.getState();
  if (!hasKey) {
    useAIStore.setState({ testState: 'fail', testMessage: '未填写 API Key（可开启离线演示模式）' });
    return false;
  }
  useAIStore.setState({ testState: 'loading', testMessage: '' });
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    useAIStore.setState({ testState: 'ok', testMessage: '连接可用' });
    return true;
  } catch (err) {
    useAIStore.setState({ testState: 'fail', testMessage: (err as Error).message });
    return false;
  }
}

/** 给组件用的门面，保证 Settings 与 AI 面板共享同一份状态 */
export function useAIConfig() {
  const config = useAIStore((s) => s.config);
  const hasKey = useAIStore((s) => s.hasKey);
  const testState = useAIStore((s) => s.testState);
  const testMessage = useAIStore((s) => s.testMessage);
  const apiKey = useAIStore((s) => s.apiKey);
  return {
    config: { ...config, apiKeyMasked: apiKey ? '••••••••••••' : '' },
    hasKey,
    save: saveAI,
    test: testAI,
    testState,
    testMessage,
    apiKey,
  };
}
