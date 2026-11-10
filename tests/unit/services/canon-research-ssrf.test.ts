import { describe, expect, it } from 'vitest';
import { isPrivateHost } from '../../../services/canon-research-service';

/**
 * S-9（安全二轮）：同人考据抓取必须拦截 IPv6 私网/链路本地/IPv4-mapped 与尾点
 * localhost。此前只处理 `::1` 与点分 IPv4，`http://[::ffff:127.0.0.1]:11434/`
 * 等地址可直接打到本机 Ollama 并把响应写进 vault。
 */
describe('canon-research — isPrivateHost SSRF 边界', () => {
    it('拦截 IPv4 私网/回环/链路本地', () => {
        for (const host of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.10.1', '0.0.0.0', '100.64.0.1']) {
            expect(isPrivateHost(host), host).toBe(true);
        }
    });

    it('拦截 IPv6 回环/唯一本地/链路本地/未指定', () => {
        for (const host of ['[::1]', '::1', '[::]', '[fc00::1]', '[fd12:3456::1]', '[fe80::1]']) {
            expect(isPrivateHost(host), host).toBe(true);
        }
    });

    it('拦截 IPv4-mapped 两种写法（点分与十六进制）', () => {
        for (const host of ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:192.168.1.1]']) {
            expect(isPrivateHost(host), host).toBe(true);
        }
    });

    it('拦截尾点 localhost / .local', () => {
        expect(isPrivateHost('localhost.')).toBe(true);
        expect(isPrivateHost('LOCALHOST')).toBe(true);
        expect(isPrivateHost('printer.local.')).toBe(true);
    });

    it('公网地址不误杀', () => {
        for (const host of ['8.8.8.8', 'example.com', 'example.com.', '[2001:4860:4860::8888]', 'api.openai.com']) {
            expect(isPrivateHost(host), host).toBe(false);
        }
    });
});
