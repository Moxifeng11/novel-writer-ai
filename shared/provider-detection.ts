/**
 * provider-detection.ts — 从 API 端点 URL 识别供应商/协议
 *
 * 目标不是替代设置窗口，而是在用户粘贴 URL 时给出可信的默认值：
 * - 识别已知云端供应商（火山/DeepSeek/SenseNova/CatCat/OpenAI 等）
 * - 识别本地/私有网络服务（Ollama / LM Studio / vLLM）
 * - 区分 OpenAI 兼容协议与 Ollama 原生协议
 *
 * 纯函数、无 Obsidian 依赖，便于单测和设置页复用。
 */

export type ProviderApiStyle = 'openai' | 'ollama' | 'custom';
export type ProviderSourceType = 'cloud' | 'local';

export interface ProviderDetection {
    /** URL 是否可解析 */
    valid: boolean;
    /** 用户原始输入（已 trim） */
    input: string;
    /** 规范化后的端点（去掉 query/hash，补全协议与默认路径） */
    normalizedEndpoint: string;
    /** 命中的预设供应商 ID；未知时为 null */
    providerId: string | null;
    /** 显示名称（未知时用 host） */
    name: string;
    sourceType: ProviderSourceType;
    apiStyle: ProviderApiStyle;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
    warning?: string;
}

interface KnownProvider {
    id: string;
    name: string;
    hosts: string[];
    defaultPath?: string;
    apiStyle: ProviderApiStyle;
}

const KNOWN_PROVIDERS: KnownProvider[] = [
    { id: 'volc', name: '火山引擎豆包', hosts: ['ark.cn-beijing.volces.com', 'volces.com'], defaultPath: '/api/v3/chat/completions', apiStyle: 'openai' },
    { id: 'deepseek', name: 'DeepSeek 官网', hosts: ['api.deepseek.com'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'sensenova', name: '日日新/SenseNova', hosts: ['token.sensenova.cn'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'catcat', name: 'CatCat Gemini', hosts: ['api.catcat.top'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'openai', name: 'OpenAI', hosts: ['api.openai.com'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'qwen', name: '通义千问/DashScope', hosts: ['dashscope.aliyuncs.com'], defaultPath: '/compatible-mode/v1/chat/completions', apiStyle: 'openai' },
    { id: 'gemini', name: 'Google Gemini', hosts: ['generativelanguage.googleapis.com'], apiStyle: 'custom' },
    { id: 'openrouter', name: 'OpenRouter', hosts: ['openrouter.ai'], defaultPath: '/api/v1/chat/completions', apiStyle: 'openai' },
    { id: 'siliconflow', name: 'SiliconFlow', hosts: ['api.siliconflow.cn'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'moonshot', name: 'Moonshot', hosts: ['api.moonshot.cn'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'groq', name: 'Groq', hosts: ['api.groq.com'], defaultPath: '/openai/v1/chat/completions', apiStyle: 'openai' },
    { id: 'together', name: 'Together AI', hosts: ['api.together.xyz'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
    { id: 'mistral', name: 'Mistral', hosts: ['api.mistral.ai'], defaultPath: '/v1/chat/completions', apiStyle: 'openai' },
];

const LOCAL_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'host.docker.internal',
]);

function isPrivateHost(host: string): boolean {
    if (LOCAL_HOSTS.has(host)) return true;
    if (host.endsWith('.local')) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    return false;
}

function hostMatches(host: string, known: string): boolean {
    return host === known || host.endsWith(`.${known}`);
}

function urlWithoutSecret(url: URL): string {
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

function withDefaultPath(url: URL, defaultPath?: string): string {
    if (!defaultPath) return urlWithoutSecret(url);
    const path = url.pathname.replace(/\/+$/, '');
    // 用户常只填 base URL（/v1、/api/v3 等）；已知供应商补成完整 chat 端点。
    const basePaths = new Set(['/v1', '/api/v1', '/api/v3', '/openai/v1', '/compatible-mode/v1']);
    if (!path || basePaths.has(path)) {
        url.pathname = defaultPath;
    }
    return urlWithoutSecret(url);
}

function looksLikeOllamaPath(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.includes('/api/generate')
        || lower.includes('/api/chat')
        || lower.includes('/api/embeddings')
        || lower.includes('/api/embed');
}

/**
 * 从端点 URL 识别供应商。
 *
 * 对无法解析的输入返回 valid=false，但保留原始输入供 UI 提示，
 * 不会静默把错误 URL 写进设置。
 */
export function detectProviderFromEndpoint(raw: string): ProviderDetection {
    const input = (raw || '').trim();
    if (!input) {
        return {
            valid: false,
            input,
            normalizedEndpoint: '',
            providerId: null,
            name: '未填写',
            sourceType: 'cloud',
            apiStyle: 'custom',
            confidence: 'low',
            reasons: [],
            warning: '端点为空',
        };
    }

    const hasScheme = /^https?:\/\//i.test(input);
    let candidate = input;
    if (!hasScheme) {
        const hostGuess = input.split('/')[0].split(':')[0].toLowerCase();
        const likelyLocal = isPrivateHost(hostGuess) || input.includes(':11434');
        candidate = `${likelyLocal ? 'http' : 'https'}://${input}`;
    }

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return {
            valid: false,
            input,
            normalizedEndpoint: input,
            providerId: null,
            name: '无法解析',
            sourceType: 'cloud',
            apiStyle: 'custom',
            confidence: 'low',
            reasons: [],
            warning: 'URL 格式无法解析，请检查是否缺少协议或包含非法字符',
        };
    }

    const host = url.hostname.toLowerCase();
    const path = url.pathname || '';
    const port = url.port;
    const reasons: string[] = [];

    // 1) 本地/私有网络优先：即使路径像 OpenAI 兼容层，也不能误判为云端
    if (isPrivateHost(host)) {
        const ollamaByPort = port === '11434';
        const ollamaByPath = looksLikeOllamaPath(path);
        const apiStyle: ProviderApiStyle = (ollamaByPort || ollamaByPath) ? 'ollama' : 'openai';
        reasons.push(isPrivateHost(host) ? '主机名为 localhost/私有网段' : '本地网络');
        if (ollamaByPort) reasons.push('端口 11434 是 Ollama 默认端口');
        if (ollamaByPath) reasons.push('路径包含 Ollama 原生 /api 端点');
        if (apiStyle === 'openai') {
            // 本地 OpenAI 兼容服务默认补 /v1/chat/completions，避免把 base URL 当完整端点
            if (!path.replace(/\/+$/, '')) url.pathname = '/v1/chat/completions';
        }
        return {
            valid: true,
            input,
            normalizedEndpoint: withDefaultPath(url, '/v1/chat/completions'),
            providerId: apiStyle === 'ollama' ? 'ollama' : null,
            name: apiStyle === 'ollama' ? '本地 Ollama' : '本地 OpenAI 兼容服务',
            sourceType: 'local',
            apiStyle,
            confidence: 'high',
            reasons,
        };
    }

    // 2) 已知云端供应商
    const known = KNOWN_PROVIDERS.find(p => p.hosts.some(h => hostMatches(host, h)));
    if (known) {
        if (looksLikeOllamaPath(path)) {
            return {
                valid: true,
                input,
                normalizedEndpoint: urlWithoutSecret(url),
                providerId: known.id,
                name: known.name,
                sourceType: 'cloud',
                apiStyle: 'ollama',
                confidence: 'medium',
                reasons: [`主机匹配 ${known.name}`, '路径为 Ollama 原生端点，请确认该服务确实支持 Ollama 协议'],
                warning: '已知云端供应商通常不使用 Ollama 原生 /api 路径，请确认端点是否正确',
            };
        }
        reasons.push(`主机匹配 ${known.name}`);
        return {
            valid: true,
            input,
            normalizedEndpoint: withDefaultPath(url, known.defaultPath),
            providerId: known.id,
            name: known.name,
            sourceType: 'cloud',
            apiStyle: known.apiStyle,
            confidence: 'high',
            reasons,
        };
    }

    // 3) 未知主机：按 OpenAI 兼容端点处理，但明确标低置信度
    const apiStyle: ProviderApiStyle = looksLikeOllamaPath(path) ? 'ollama' : 'openai';
    reasons.push('未匹配已知供应商');
    return {
        valid: true,
        input,
        normalizedEndpoint: withDefaultPath(url, apiStyle === 'openai' && !path.replace(/\/+$/, '') ? '/v1/chat/completions' : undefined),
        providerId: null,
        name: host,
        sourceType: 'cloud',
        apiStyle,
        confidence: 'low',
        reasons,
        warning: apiStyle === 'openai'
            ? '未识别为已知供应商，将按 OpenAI 兼容端点处理'
            : '未识别为已知供应商，但路径像 Ollama 原生端点，请确认服务类型',
    };
}
