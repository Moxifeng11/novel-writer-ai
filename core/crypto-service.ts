/**
 * crypto-service.ts — API 密钥加密服务
 *
 * 职责：AES-GCM 256 位加密/解密
 * 从 main.ts 拆分而来（v3.5.0 加密存储 → v6.1 Web Crypto API）
 *
 * F4（技术审计，v2 口令派生）：
 * - 旧版（v1）密钥种子为公开常量 `novel-writer-ai:${vaultPath}:v3.5.0-salt`，
 *   任何知道 vault 路径的人都能推导出密钥解开 data.json 中存储的 API 密钥，
 *   实质是确定性混淆而非保密。
 * - v2 格式 `aes256v2:<iterations>:<salt>:<iv>:<ct>` 改为用户口令 + PBKDF2-SHA256
 *   派生（每条密文独立随机 salt）。口令仅存内存（会话级），不落 data.json，
 *   Obsidian 重启后首次解密时重新询问。
 * - v1 密文永久兼容读取（旧 seed 路径保留）；用户下次在设置中保存密钥时
 *   自然升级为 v2，无需迁移工具。
 * - 用户在设置口令时取消 → 密钥以明文保存（并提示），保持向下兼容。
 */

import { Notice } from 'obsidian';
import { createLogger } from '../shared/logger';


const log = createLogger('CryptoService');

/** v2 PBKDF2 迭代次数（OWASP 2023 对 PBKDF2-SHA256 的推荐下限区间，兼顾启动延迟） */
const PBKDF2_ITERATIONS = 210_000;
/** v2 格式前缀（v1 为 `aes256:`，无版本前缀视为明文） */
const V2_PREFIX = 'aes256v2:';

/** CryptoService 所需的最小 App 接口 */
export interface CryptoServiceDeps {
    vault: {
        adapter: { basePath?: string };
        getName(): string;
    };
}

/** F4：口令交互回调（由 UI 层注入，保持本服务无 UI 依赖） */
export interface CryptoPasswordCallbacks {
    /** 解密 v2 密文需要口令时调用；返回 null 表示用户取消 */
    requestPassword?: () => Promise<string | null>;
    /** 首次加密需要设定口令时调用；返回 null 表示用户取消（密钥将明文保存） */
    requestNewPassword?: () => Promise<string | null>;
    /**
     * 返回任意一条已存在磁盘上的 v2 密文，用于判断「是否已经设过口令」。
     *
     * 关键用途：只要磁盘上已有密文，本次会话就不能再走「设定新口令」——
     * 否则新口令会覆盖会话口令，导致旧密文永久无法解开（历史 bug：
     * 每次重启后保存任意密钥都会让用户重设口令，旧密钥随即失效）。
     */
    findExistingCiphertext?: () => string | null;
}

/**
 * 加密服务：敏感配置（API Key 等）的安全存取。
 */
export class CryptoService {
    private _legacyKey: CryptoKey | null = null;
    private _legacyKeyPromise: Promise<CryptoKey> | null = null;
    /** 会话口令（仅内存，重启即失）：由 requestPassword / requestNewPassword 设定 */
    private _password: string | null = null;
    /** 本会话口令询问的并发去重：多个密钥同时解密时只弹一个口令框 */
    private _askPromise: Promise<string | null> | null = null;
    /** 按 salt 缓存已派生的 v2 密钥，避免同 salt 重复执行 21 万次 PBKDF2 */
    private _derivedKeys = new Map<string, CryptoKey>();
    private readonly deps: CryptoServiceDeps;
    private readonly callbacks: CryptoPasswordCallbacks;

    constructor(deps: CryptoServiceDeps, callbacks: CryptoPasswordCallbacks = {}) {
        this.deps = deps;
        this.callbacks = callbacks;
    }

    /**
     * 设置会话口令（解密验证成功后调用；供 UI「修改口令」等入口复用）
     *
     * @param password - 口令
     */
    setSessionPassword(password: string): void {
        this._password = password;
        this._derivedKeys.clear();
    }

    /** 清除会话口令与派生缓存（锁定效果：下次解密需重新输入） */
    clearSessionPassword(): void {
        this._password = null;
        this._derivedKeys.clear();
    }

    /**
     * 当前是否已有会话口令
     *
     * @returns 是否成功
     */
    hasSessionPassword(): boolean {
        return this._password != null;
    }

    // ─── v1（旧 seed 派生，仅保留兼容读取） ───

    private async getLegacyKey(): Promise<CryptoKey> {
        if (this._legacyKey) return this._legacyKey;
        if (this._legacyKeyPromise) return this._legacyKeyPromise;
        this._legacyKeyPromise = (async () => {
            const vaultPath = this.deps.vault.adapter.basePath || this.deps.vault.getName();
            const seed = `novel-writer-ai:${vaultPath}:v3.5.0-salt`;
            const seedBytes = new TextEncoder().encode(seed);
            const hashBuffer = await crypto.subtle.digest('SHA-256', seedBytes);
            const key = await crypto.subtle.importKey(
                'raw', hashBuffer,
                { name: 'AES-GCM', length: 256 },
                false, ['encrypt', 'decrypt']
            );
            this._legacyKey = key;
            return key;
        })();
        return this._legacyKeyPromise;
    }

    // ─── v2（口令 + PBKDF2 派生） ───

    private async deriveV2Key(password: string, saltB64: string, iterations: number): Promise<CryptoKey> {
        const cached = this._derivedKeys.get(saltB64);
        if (cached) return cached;
        const passwordKey = await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(password),
            { name: 'PBKDF2' }, false, ['deriveKey']
        );
        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: this.base64ToBytes(saltB64),
                iterations,
                hash: 'SHA-256',
            },
            passwordKey,
            { name: 'AES-GCM', length: 256 },
            false, ['encrypt', 'decrypt']
        );
        this._derivedKeys.set(saltB64, key);
        return key;
    }

    /**
     * 获取会话口令；无则通过回调询问。返回 null 表示用户取消或无回调可用。
     *
     * `isNew` 只在「从来没有密文」时才会去问「设定新口令」。一旦磁盘上
     * 已有 v2 密文，即使调用方请求的是「新口令」，也必须改问已有口令并
     * **验证它确实能解开既有密文**——否则用户会以为在重设口令，实际是
     * 用第二套口令加密，旧密钥从此永久失效。
     */
    private async ensurePassword(isNew: boolean): Promise<string | null> {
        if (this._password != null) return this._password;
        // 并发去重：启动时多个密文同时解密，只应弹一个口令框
        if (this._askPromise) return this._askPromise;

        const existingCipher = isNew ? (this.callbacks.findExistingCiphertext?.() ?? null) : null;
        const mustUseExisting = !!existingCipher;
        const ask = (isNew && !mustUseExisting)
            ? this.callbacks.requestNewPassword
            : this.callbacks.requestPassword;
        if (!ask) {
            log.warn('[小说工坊] 未注入口令回调，无法进行 v2 加解密');
            return null;
        }

        this._askPromise = (async () => {
            // 已有密文时给两次机会：口令必须能解开它才算有效
            const attempts = mustUseExisting ? 2 : 1;
            for (let i = 0; i < attempts; i++) {
                const password = await ask();
                if (!password) return null;
                if (mustUseExisting) {
                    const ok = await this.verifyPasswordAgainst(password, existingCipher!);
                    if (!ok) {
                        new Notice('小说工坊：口令与已保存的密钥不匹配，请重新输入（不是设置新口令）');
                        continue;
                    }
                }
                this._password = password;
                return password;
            }
            return null;
        })();
        try {
            return await this._askPromise;
        } finally {
            this._askPromise = null;
        }
    }

    /**
     * 用候选口令试解一条已有密文，判断它是不是「正确的那个口令」。
     * 故意绕过 `_derivedKeys` 缓存：错误口令派生出的 key 若被缓存，
     * 后续用正确口令时会命中脏缓存。
     */
    private async verifyPasswordAgainst(password: string, stored: string): Promise<boolean> {
        const parsed = this.parseV2(stored);
        if (!parsed) return true;
        try {
            const passwordKey = await crypto.subtle.importKey(
                'raw', new TextEncoder().encode(password),
                { name: 'PBKDF2' }, false, ['deriveKey']
            );
            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: this.base64ToBytes(parsed.saltB64),
                    iterations: parsed.iterations,
                    hash: 'SHA-256',
                },
                passwordKey,
                { name: 'AES-GCM', length: 256 },
                false, ['decrypt']
            );
            await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: this.base64ToBytes(parsed.ivB64) },
                key,
                this.base64ToBytes(parsed.cipherB64),
            );
            return true;
        } catch {
            return false;
        }
    }

    /** 解析 v2 密文；格式不合法返回 null */
    private parseV2(stored: string): { iterations: number; saltB64: string; ivB64: string; cipherB64: string } | null {
        if (!stored.startsWith(V2_PREFIX)) return null;
        const parts = stored.slice(V2_PREFIX.length).split(':');
        if (parts.length !== 4) return null;
        const iterations = parseInt(parts[0]);
        if (!Number.isFinite(iterations) || iterations <= 0) return null;
        return { iterations, saltB64: parts[1], ivB64: parts[2], cipherB64: parts[3] };
    }

    // ─── 编解码工具 ───

    private bytesToBase64(bytes: Uint8Array): string {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    private base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes as unknown as Uint8Array<ArrayBuffer>;
    }

    // ─── 对外 API ───

    /**
     * 加密明文。v2：口令 + PBKDF2。
     * 无会话口令时通过 requestNewPassword 询问；用户取消则明文返回（保持向下兼容）。
     * @param plaintext - 明文
     * @returns 文本结果
     */
    async encrypt(plaintext: string): Promise<string> {
        const encrypted = await this.encryptStrict(plaintext);
        if (encrypted !== null) return encrypted;
        log.warn('[小说工坊] 未设置口令，密钥将以明文保存（可在设置中重新保存以启用加密）');
        return plaintext;
    }

    /**
     * 严格加密：拿不到口令时返回 null，**绝不回退明文**。
     *
     * 设置持久化必须用这个：磁盘上已有密文时若拿不到口令，
     * 写回明文会把原本受保护的值降级，同时造成「部分加密部分明文」的
     * 混合状态（历史 bug 的表现之一）。
     * @param plaintext - 明文
      * @returns 文本结果 或 null
     */
    async encryptStrict(plaintext: string): Promise<string | null> {
        if (!plaintext) return '';
        const password = await this.ensurePassword(true);
        if (!password) return null;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const saltB64 = this.bytesToBase64(salt);
        const key = await this.deriveV2Key(password, saltB64, PBKDF2_ITERATIONS);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)
        );
        return `${V2_PREFIX}${PBKDF2_ITERATIONS}:${saltB64}:${this.bytesToBase64(iv)}:${this.bytesToBase64(new Uint8Array(ciphertext))}`;
    }

    /**
     * 该密文能否用给定口令解开。
     * 供「重置口令」流程判断哪些条目需要用户重新输入。
     * @param password - 口令
     * @param stored - 已存储值
     * @returns 是否成功
     */
    async canDecryptWith(password: string, stored: string): Promise<boolean> {
        if (!stored) return true;
        if (!stored.startsWith(V2_PREFIX)) return true;
        return this.verifyPasswordAgainst(password, stored);
    }

    /**
     * 解密密文。
     * - `aes256v2:` → 口令派生解密（无会话口令时询问；口令错误重问一次）
     * - `aes256:`   → v1 旧 seed 兼容读取
     * - 其他        → 视为明文原样返回
     * @param stored - 已存储值
     * @returns 文本结果
     */
    async decrypt(stored: string): Promise<string> {
        if (!stored) return '';
        if (stored.startsWith(V2_PREFIX)) {
            return this.decryptV2(stored);
        }
        if (!stored.startsWith('aes256:')) return stored;
        try {
            const key = await this.getLegacyKey();
            const parts = stored.slice(7).split(':');
            if (parts.length !== 2) return stored;
            const iv = this.base64ToBytes(parts[0]);
            const ciphertextWithTag = this.base64ToBytes(parts[1]);
            const plaintext = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv }, key, ciphertextWithTag
            );
            return new TextDecoder().decode(plaintext);
        } catch (e) {
            log.warn('[小说工坊] 密钥解密失败:', e);
            new Notice('小说工坊：数据读取异常，部分功能可能受限');
            return stored;
        }
    }

    /**
     * 启动期静默解密：仅有会话口令时才解密 v2 密文，否则原样返回。
     * 用于 loadSettings——插件启动不应弹口令框阻塞 onload（否则视图/命令注册不完成，
     * 表现为「插件无法正常使用」）。真正调用 AI 时再由 resolveApiKey 按需解锁。
     * @param stored - 已存储值
     * @returns 文本结果
     */
    async decryptWithoutPrompt(stored: string): Promise<string> {
        if (!stored) return '';
        if (stored.startsWith(V2_PREFIX) && !this.hasSessionPassword()) return stored;
        return this.decrypt(stored);
    }

    /** v2 解密：口令错误时清除会话口令并重问一次，仍失败则原样返回 */
    private async decryptV2(stored: string): Promise<string> {
        const parts = stored.slice(V2_PREFIX.length).split(':');
        if (parts.length !== 4) return stored;
        const iterations = parseInt(parts[0]);
        const saltB64 = parts[1];
        if (!Number.isFinite(iterations) || iterations <= 0) return stored;

        for (let attempt = 0; attempt < 2; attempt++) {
            const password = await this.ensurePassword(false);
            if (!password) {
                new Notice('小说工坊：已加密的密钥需要口令才能读取');
                return stored;
            }
            try {
                const key = await this.deriveV2Key(password, saltB64, iterations);
                const iv = this.base64ToBytes(parts[2]);
                const ciphertextWithTag = this.base64ToBytes(parts[3]);
                const plaintext = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv }, key, ciphertextWithTag
                );
                return new TextDecoder().decode(plaintext);
            } catch (e) {
                // 口令错误（GCM 校验失败）：清除会话口令与派生缓存后重问
                log.warn(`[小说工坊] v2 解密失败（第 ${attempt + 1} 次）:`, e);
                this.clearSessionPassword();
            }
        }
        new Notice('小说工坊：口令错误，已加密的密钥无法读取');
        return stored;
    }
}
