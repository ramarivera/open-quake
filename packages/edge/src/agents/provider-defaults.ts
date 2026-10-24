// CENTER-070: recovered provider defaults and common model suggestions. No cloud catalog.
export const providerDefaults = [
	{
		id: "openai",
		baseUrl: "https://api.openai.com/v1",
		models: [
			{
				id: "gpt-4o",
				maxTokens: 4096,
			},
			{
				id: "gpt-4o-mini",
				maxTokens: 4096,
			},
			{
				id: "gpt-4.1",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.4",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.4-mini",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.2",
				maxTokens: 4096,
			},
			{
				id: "gpt-4",
				maxTokens: 4096,
			},
			{
				id: "gpt-4-turbo-preview",
				maxTokens: 4096,
			},
			{
				id: "gpt-3.5-turbo",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "azure",
		baseUrl: "https://{resource}.openai.azure.com",
		models: [
			{
				id: "gpt-4",
				maxTokens: 4096,
			},
			{
				id: "gpt-35-turbo",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "anthropic",
		baseUrl: "https://api.anthropic.com",
		models: [
			{
				id: "claude-3-opus-20240229",
				maxTokens: 4096,
			},
			{
				id: "claude-3-sonnet-20240229",
				maxTokens: 4096,
			},
			{
				id: "claude-3-haiku-20240307",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "gemini",
		baseUrl: "https://generativelanguage.googleapis.com",
		models: [
			{
				id: "gemini-pro",
				maxTokens: 4096,
			},
			{
				id: "gemini-ultra",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "google",
		baseUrl: "https://generativelanguage.googleapis.com",
		models: [
			{
				id: "gemini-pro",
				maxTokens: 4096,
			},
			{
				id: "gemini-ultra",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "moonshot",
		baseUrl: "https://api.moonshot.cn/v1",
		models: [
			{
				id: "kimi-k2.6",
				maxTokens: 4096,
			},
			{
				id: "kimi-k2.5",
				maxTokens: 4096,
			},
			{
				id: "kimi-k2-thinking",
				maxTokens: 4096,
			},
			{
				id: "kimi-k2-thinking-turbo",
				maxTokens: 4096,
			},
			{
				id: "kimi-k2-turbo",
				maxTokens: 4096,
			},
			{
				id: "moonshot-v1-8k",
				maxTokens: 4096,
			},
			{
				id: "moonshot-v1-32k",
				maxTokens: 4096,
			},
			{
				id: "moonshot-v1-128k",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "codex",
		baseUrl: "https://chatgpt.com/backend-api/v1",
		models: [
			{
				id: "gpt-5.4",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.4-mini",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.2",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "openai-codex",
		baseUrl: "https://chatgpt.com/backend-api/v1",
		models: [
			{
				id: "gpt-5.4",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.4-mini",
				maxTokens: 4096,
			},
			{
				id: "gpt-5.2",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "minimax",
		baseUrl: "https://api.minimaxi.com/anthropic",
		models: [
			{
				id: "MiniMax-M2.7",
				maxTokens: 4096,
			},
			{
				id: "MiniMax-M2.7-highspeed",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "kimi",
		baseUrl: "https://api.kimi.com/coding/",
		models: [
			{
				id: "kimi-code",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "kimi-coding",
		baseUrl: "https://api.kimi.com/coding/",
		models: [
			{
				id: "k2p5",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "deepseek",
		baseUrl: "https://api.deepseek.com",
		models: [
			{
				id: "deepseek-v4-pro",
				maxTokens: 4096,
			},
			{
				id: "deepseek-v4-flash",
				maxTokens: 4096,
			},
			{
				id: "deepseek-chat",
				maxTokens: 4096,
			},
			{
				id: "deepseek-reasoner",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "qwen",
		baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		models: [
			{
				id: "qwen3.5-plus",
				maxTokens: 4096,
			},
			{
				id: "qwen3.6-plus",
				maxTokens: 4096,
			},
			{
				id: "qwen3-coder-plus",
				maxTokens: 4096,
			},
			{
				id: "qwen3-max-2026-01-23",
				maxTokens: 4096,
			},
		],
	},
	{
		id: "custom",
		baseUrl: "",
		models: [],
	},
];
