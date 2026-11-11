/**
 * private-host.ts — 主机名是否指向本机/内网（SSRF 防护的单一实现）。
 *
 * 此前只有同人考据服务内部有这套判断；自定义更新地址等第二个网络入口
 * 没有复用，形成盲 SSRF 旁路（S3-13）。这里抽成 shared 单一实现。
 */

/** IPv4 私网/回环/链路本地/保留段 */
function isPrivateIpv4(host: string): boolean {
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const octets = match.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
}

/** IPv6 私网/回环/链路本地：展开前 16 位 + IPv4-mapped 末 32 位 */
function isPrivateIpv6(host: string): boolean {
    const value = host.split('%')[0];
    if (value === '::' || value === '::1' || value === '0:0:0:0:0:0:0:0' || value === '0:0:0:0:0:0:0:1') return true;
    // ::ffff:127.0.0.1（点分）与 ::ffff:7f00:1（十六进制）两种映射写法
    const mappedDotted = value.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);
    const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    const first = parseInt(value.split(':')[0] || '0', 16);
    if (!Number.isFinite(first)) return false;
    return (first & 0xfe00) === 0xfc00 // fc00::/7 唯一本地
        || (first & 0xffc0) === 0xfe80; // fe80::/10 链路本地
}

/**
 * 判断主机名是否指向本机/内网（SSRF 防护；导出供表驱动测试）。
 *
 * @param hostname - URL.hostname（可含 IPv6 方括号）
 * @returns 是否私网/回环
 */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '')
        .toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (isPrivateIpv4(host)) return true;
    if (host.includes(':')) return isPrivateIpv6(host);
    return false;
}
