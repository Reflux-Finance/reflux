import { createSuiClient, readEnv } from '@reflux/lib';

const _env = readEnv(process.env as Record<string, string>);

export const suiClient = createSuiClient(_env.NEXT_PUBLIC_SUI_NETWORK);

export const env = _env;
