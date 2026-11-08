/**
 * support-author.ts — 「支持作者」入口的展示信息（纯函数，可测）
 *
 * 背景（2026-11-09 用户要求）：设置页增加「支持」按钮，通过支付宝转账支持作者。
 *
 * 为什么不做支付宝开放平台支付产品（当面付 / 订单码 / 电脑网站支付）：
 * 那些产品要求商户号 + 应用私钥 + 服务端签名验签，而本插件是**纯客户端、开源**的
 * Obsidian 插件：
 *  - 把商户私钥打进 main.js 等于公开私钥，任何人都能伪造订单/退款；
 *  - 没有服务端就无法安全保存私钥与异步通知，也无法完成签名；
 * 因此这里采用「收款账号 + 手动转账」的安全形态：只展示账号与步骤，
 * 插件不发起支付、不读取任何支付信息，也不收集用户数据。
 */

/** 支付宝收款账号（用户 2026-11-09 提供） */
export const ALIPAY_SUPPORT_ACCOUNT = '2667520188';

/** 支持入口展示信息 */
export interface AlipaySupportInfo {
    /** 面板标题 */
    title: string;
    /** 收款支付宝账号 */
    account: string;
    /** 一句话说明 */
    intro: string;
    /** 操作步骤（有序） */
    steps: string[];
    /** 免责/边界说明 */
    note: string;
}

/**
 * 生成「支持作者」面板的展示信息。
 *
 * @returns 标题、账号、步骤与说明
 */
export function describeAlipaySupport(): AlipaySupportInfo {
    return {
        title: '支持作者',
        account: ALIPAY_SUPPORT_ACCOUNT,
        intro: '如果「小说工坊 AI」帮你省下了时间，欢迎请作者喝杯咖啡。',
        steps: [
            '打开支付宝，进入「转账」',
            `输入账号 ${ALIPAY_SUPPORT_ACCOUNT}`,
            '金额随意（备注可写「小说工坊」）',
        ],
        note: '自愿支持，不影响任何功能；插件不发起支付、不读取支付信息，也不收集用户数据。',
    };
}
