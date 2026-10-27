#!/usr/bin/env node
/**
 * eval-cowrite-local.mjs — 本地 Ollama 协同写作冒烟评估
 *
 * 不进入 npm test：没有 Ollama / 没有模型时直接跳过并退出 0。
 * 有模型时跑两次固定请求（3 候选 / 3 改写），输出调用次数、耗时、JSON 合法率。
 *
 * 用法：
 *   npm run eval:cowrite-local
 *   OLLAMA_ENDPOINT=http://localhost:11434 OLLAMA_MODEL=qwen2.5:7b npm run eval:cowrite-local
 */

const endpoint = (process.env.OLLAMA_ENDPOINT || 'http://localhost:11434').replace(/\/+$/, '');
const modelOverride = process.env.OLLAMA_MODEL || '';

const CONTEXT = `雨下了一整夜。林深站在废弃码头的铁皮棚下，左臂的伤口被雨水泡得发白。
远处的货轮没有开灯，只有桅杆上的信号灯一明一灭。
他摸到口袋里那把生锈的钥匙，齿口硌着指腹。`;

const CANDIDATE_PROMPT = `你是小说协同写作助手。根据前文续写 3 个不同方向的候选。
只输出 JSON 数组，不要 Markdown 代码块，不要解释。
每个元素格式：{"direction":"动作|情绪|对话","text":"候选正文"}。
每个候选 1-3 句，直接可插入正文，不总结。

【前文】
${CONTEXT}`;

const REWRITE_PROMPT = `你是小说协同编辑。对选中片段给出 3 个不同方向的改写。
只输出 JSON 数组，不要 Markdown 代码块，不要解释。
每个元素格式：{"direction":"描写|情绪|对话","text":"改写正文"}。
保持剧情事实不变，长度接近原文。

【前文】
${CONTEXT}

【选中文本】
他摸到口袋里那把生锈的钥匙，齿口硌着指腹。`;

async function fetchJson(url, options, timeoutMs = 180000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function detectModel() {
    try {
        const tags = await fetchJson(`${endpoint}/api/tags`, { method: 'GET' }, 5000);
        const models = Array.isArray(tags?.models) ? tags.models.map(m => m.name).filter(Boolean) : [];
        // bge-m3 等向量模型不能做 chat；优先选生成模型，避免评估脚本误判
        const chatModels = models.filter(name => !/(^|[/:_-])(bge|gte|e5|nomic-embed|embed)/i.test(name));
        if (modelOverride) return { models, model: modelOverride };
        const preferred = chatModels.find(name => /qwen|llama|gemma|deepseek|mistral|yi|glm/i.test(name));
        return { models, model: preferred || chatModels[0] || '' };
    } catch {
        return null;
    }
}

function parseCandidates(content) {
    const text = String(content || '').trim();
    if (!text) return [];
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return [];
    try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(parsed)
            ? parsed.map(item => String(typeof item === 'string' ? item : item?.text || '').trim()).filter(Boolean)
            : [];
    } catch {
        return [];
    }
}

async function runCase(model, name, prompt) {
    const started = Date.now();
    try {
        const result = await fetchJson(`${endpoint}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                think: false,
                messages: [{ role: 'user', content: prompt }],
                options: { temperature: 0.7, num_predict: 1400 },
            }),
        });
        const elapsed = Date.now() - started;
        const content = result?.message?.content || '';
        const candidates = parseCandidates(content);
        return { name, elapsed, validJson: candidates.length > 0, candidates: candidates.length };
    } catch (error) {
        return { name, elapsed: Date.now() - started, validJson: false, candidates: 0, error: String(error?.message || error) };
    }
}

async function main() {
    const detected = await detectModel();
    if (!detected || !detected.model) {
        console.log('[eval:cowrite-local] 未检测到可用 Ollama 模型，跳过（退出 0）');
        if (detected && detected.models.length > 0) {
            console.log('[eval:cowrite-local] Ollama 可达，但没有可用于对话的生成模型（仅有向量模型）');
        }
        return;
    }

    console.log(`[eval:cowrite-local] endpoint=${endpoint} model=${detected.model}`);
    const cases = await Promise.all([
        runCase(detected.model, 'suggest-3-candidates', CANDIDATE_PROMPT),
        runCase(detected.model, 'rewrite-3-candidates', REWRITE_PROMPT),
    ]);

    let failed = 0;
    for (const item of cases) {
        const status = item.validJson ? 'PASS' : 'FAIL';
        console.log(`- ${item.name}: ${status} · ${item.elapsed}ms · JSON ${item.validJson ? 'valid' : 'invalid'} · candidates=${item.candidates}`);
        if (item.error) console.log(`  error: ${item.error}`);
        if (!item.validJson) failed++;
    }
    console.log(`[eval:cowrite-local] 调用 2 次（批量前为 6 次）；失败 ${failed}/2`);
    if (failed > 0) process.exitCode = 1;
}

main().catch(error => {
    console.error('[eval:cowrite-local] 运行异常:', error);
    process.exitCode = 1;
});