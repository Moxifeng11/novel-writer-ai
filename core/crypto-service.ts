/**
 * crypto-service.ts — API 密钥加密服务
 *
 * 职责：AES-GCM 256 位加密/解密，基于 vault 路径派生种子密钥
 * 从 main.ts 拆分而来（v3.5.0 加密存储 → v6.1 Web Crypto API）
 */

import { Notice } from 'obsidian';
import { createLogger } from '../shared/logger';


const log = createLogger('CryptoService');
/** CryptoService 所需的最小 App 接口 */
export interface CryptoServiceDeps {
    vault: {
        adapter: { basePath?: string };
        getName(): string;
    };
}

export class CryptoService {
    private _cryptoKey: CryptoKey | null = null;
    private _cryptoKeyPromise: Promise<CryptoKey> | null = null;
    private readonly deps: CryptoServiceDeps;

    constructor(deps: CryptoServiceDeps) {
        this.deps = deps;
    }

    private async getCryptoKey(): Promise<CryptoKey> {
        if (this._cryptoKey) return this._cryptoKey;
        if (this._cryptoKeyPromise) return this._cryptoKeyPromise;
        this._cryptoKeyPromise = (async () => {
            const vaultPath = this.deps.vault.adapter.basePath || this.deps.vault.getName();
            const seed = `novel-writer-ai:${vaultPath}:v3.5.0-salt`;
            const seedBytes = new TextEncoder().encode(seed);
            const hashBuffer = await crypto.subtle.digest('SHA-256', seedBytes);
            const key = await crypto.subtle.importKey(
                'raw', hashBuffer,
                { name: 'AES-GCM', length: 256 },
                false, ['encrypt', 'decrypt']
            );
            this._cryptoKey = key;
            return key;
        })();
        return this._cryptoKeyPromise;
    }

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

    async encrypt(plaintext: string): Promise<string> {
        if (!plaintext) return '';
        const key = await this.getCryptoKey();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const plaintextBytes = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv }, key, plaintextBytes
        );
        return `aes256:${this.bytesToBase64(iv)}:${this.bytesToBase64(new Uint8Array(ciphertext))}`;
    }

    async decrypt(stored: string): Promise<string> {
        if (!stored) return '';
        if (!stored.startsWith('aes256:')) return stored;
        try {
            const key = await this.getCryptoKey();
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
}
