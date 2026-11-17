/**
 * en-US.ts — English UI copy.
 *
 * Structure and placeholders must mirror `zh-CN.ts` exactly; `npm run check:i18n`
 * compares flattened keys and `{placeholder}` sets in both directions.
 */

import type { MessageTree } from './zh-CN';

export const enUS: MessageTree = {
    common: {
        cancel: 'Cancel',
        confirm: 'OK',
        close: 'Close',
        refresh: 'Refresh',
        loading: 'Loading…',
    },
    settings: {
        group: {
            connect: '🔌 Connect & Models',
            writing: '✍️ Writing & Co-writing',
            rules: '📜 Rules & Consistency',
            knowledge: '📚 Knowledge & Deconstruction',
            ui: '🎨 Interface & Workspace',
            ops: '🗂 Projects & Operations',
        },
        tab: {
            setup: '🚀 First Run & Self-check',
            api: '🔌 API Configuration',
            cowrite: '🖥 Co-writing',
            writing: '✍️ Writing Settings',
            modes: '🎯 Creation Modes',
            recognition: '🎭 Character Recognition',
            suggestions: '💡 Suggestions',
            template: '📋 Templates',
            fingerprint: '🔍 Style Fingerprints',
            knowledge: '📚 Writing Knowledge Base',
            deconstruction: '🧬 Deconstruction Engine',
            foreshadow: '🔮 Foreshadowing',
            rules: '📜 Writing Rules',
            appearance: '🎨 Appearance',
            layout: '🧩 Workspace Layout',
            projects: '🗂 Project Library Migration',
            performance: '📈 Performance Monitor',
            agent: '🤖 Agent Chat',
            mcp: '🔌 MCP Servers',
            about: 'ℹ️ About',
        },
        shell: {
            title: '📖 Settings',
            searchPlaceholder: 'Search settings, e.g. "AI flavor", "word goal", "MCP"…',
            searchEmpty: 'No matching settings',
            showAdvanced: '⚙ Advanced settings',
            hideAdvanced: '⚙ Hide advanced',
            unknownTab: 'Unknown settings tab: {tabId}',
        },
        appearance: {
            language: {
                name: 'Interface language',
                desc: 'Language of the plugin UI. Chinese and English are available for now; "Follow Obsidian" uses the app language and falls back to Chinese.',
                auto: 'Follow Obsidian',
                zhCN: '简体中文',
                enUS: 'English',
            },
        },
    },
    tts: {
        title: '🎧 Listen & proofread',
        play: 'Play',
        pause: 'Pause',
        prev: 'Previous sentence',
        next: 'Next sentence',
        stop: 'Stop',
        close: 'Close',
        rate: 'Speed',
        voice: 'Voice',
        voiceDefault: 'System default',
        progress: '{index}/{total}',
        unsupported: 'Speech synthesis is unavailable in this environment (no speechSynthesis)',
        noEditor: 'Open a Markdown editor first (select text to read only the selection)',
        noText: 'There is nothing to read here',
        finished: 'Finished reading',
        untitled: 'Current file',
        selection: 'Selection',
        error: 'Speech error: {message}',
    },
};
