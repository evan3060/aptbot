import { z } from 'zod';

export type Api = 'anthropic-messages' | 'openai-responses' | 'openai-completions';

export interface ModelConfig {
  readonly id: string;
  readonly api: Api;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface ProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl?: string;
  readonly auth: { apiKey?: string; envVar?: string };
  readonly models: ModelConfig[];
}

export interface AptbotConfig {
  readonly providers: ProviderConfig[];
  readonly defaultModel: string;
  readonly dataDir: string;
  readonly deploy: 'local' | 'cf';
  // 落地页 opt-in 开关：undefined 视为 false，确保 clone 用户零影响
  readonly landingPage?: boolean;
}

const apiSchema = z.enum([
  'anthropic-messages',
  'openai-responses',
  'openai-completions',
]);

const modelSchema = z.object({
  id: z.string().min(1),
  api: apiSchema,
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
});

const authSchema = z
  .object({
    apiKey: z.string().optional(),
    envVar: z.string().optional(),
  })
  .refine((auth) => Boolean(auth.apiKey || auth.envVar), {
    message: 'provider.auth must define apiKey or envVar',
  });

const providerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url().optional(),
  auth: authSchema,
  models: z.array(modelSchema).min(1),
});

export const configSchema: z.ZodType<AptbotConfig> = z.object({
  providers: z.array(providerSchema).min(1),
  defaultModel: z.string().min(1),
  dataDir: z.string().min(1),
  deploy: z.enum(['local', 'cf']),
  landingPage: z.boolean().optional(),
});

export const defaultConfig: AptbotConfig = {
  providers: [
    {
      id: 'anthropic',
      name: 'Anthropic',
      auth: { envVar: 'ANTHROPIC_API_KEY' },
      models: [
        {
          id: 'claude-3-5-sonnet-20241022',
          api: 'anthropic-messages',
          contextWindow: 200000,
          maxTokens: 8192,
        },
      ],
    },
  ],
  defaultModel: 'claude-3-5-sonnet-20241022',
  dataDir: './data',
  deploy: 'local',
};

export function validateConfig(
  config: unknown,
): { success: true; data: AptbotConfig } | { success: false; errors: string[] } {
  const result = configSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  };
}
