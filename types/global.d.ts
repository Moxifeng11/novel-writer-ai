// 全局类型扩展 — 语音识别 API（WebKit + 标准）+ IE 剪贴板
// full-writer-view.ts 中的 startVoiceInput() 使用
// polish-editor.ts 中的 paste 兜底使用 clipboardData

declare global {
    /** 插件版本号，由 esbuild --define 在构建时从 package.json 注入 */
    const PLUGIN_VERSION: string;

    interface Window {
        /** WebKit 前缀的 SpeechRecognition（Safari / 旧版 Chrome） */
        webkitSpeechRecognition?: typeof SpeechRecognition;
        /** 标准 SpeechRecognition 构造函数 */
        SpeechRecognition?: typeof SpeechRecognition;
        /** IE 兼容的剪贴板 API */
        clipboardData?: DataTransfer | null;
    }
}

export {};
