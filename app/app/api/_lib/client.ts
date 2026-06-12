import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { readEnv } from '@reflux/lib';

const _env = readEnv(process.env as Record<string, string>);

export const suiClient = new SuiClient({
  url: getFullnodeUrl(_env.NEXT_PUBLIC_SUI_NETWORK),
});

export const env = _env;
