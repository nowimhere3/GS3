// ==UserScript==
// @name         GS3 Fill Panel V1
// @namespace    https://github.com/nowimhere3/GS3
// @version      1.0.0
// @description  Lets native GS3 Hotswap Chrome fill a panel with generic HTML5 video.
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const SOURCE = 'gs3-capability-bridge';
    const VERSION = 1;
    const CAPABILITY = 'FILL_PANEL';
    const ACTIVE_CLASS = 'gs3-panel-fill-active';
    const DOCUMENT_ACTIVE_CLASS = 'gs3-fill-document-active';
    const OBSERVER_DEBOUNCE_MS = 140;

    let activeContainer = null;
    let activeVideo = null;
    let savedScroll = null;
    let observerTimer = null;

    function bridgeMessage(type, extra = {}) {
        return { source: SOURCE, version: VERSION, type, capability: CAPABILITY, ...extra };
    }

    function postToGs3(type, extra = {}) {
        if (window.self === window.top) return;
        window.parent.postMessage(bridgeMessage(type, extra), '*');
    }

    function getPlayerContainer(video) {
        if (!video) return null;
        return (
            video.closest('#player')
            || video.closest('.video-player')
            || video.closest('.vjs-tech')?.parentElement
            || video.parentElement
            || video
        );
    }

    function isViableVideo(video) {
        if (!(video instanceof HTMLVideoElement) || !video.isConnected) return false;
        const style = getComputedStyle(video);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const container = getPlayerContainer(video);
        return container instanceof Element && container.isConnected;
    }

    function findViablePlayer() {
        const candidates = [...document.querySelectorAll('video')].filter(isViableVideo);
        if (!candidates.length) return null;
        candidates.sort((a, b) => {
            const aBox = a.getBoundingClientRect();
            const bBox = b.getBoundingClientRect();
            return (bBox.width * bBox.height) - (aBox.width * aBox.height);
        });
        const video = candidates[0];
        return { video, container: getPlayerContainer(video) };
    }

    function announceCapability() {
        const player = findViablePlayer();
        if (!player) return false;
        postToGs3('CAPABILITY_PRESENT');
        return true;
    }

    function ensureStyles() {
        if (document.getElementById('gs3-fill-panel-style')) return;
        const style = document.createElement('style');
        style.id = 'gs3-fill-panel-style';
        style.textContent = `
            html.${DOCUMENT_ACTIVE_CLASS}, body.${DOCUMENT_ACTIVE_CLASS} {
                overflow: hidden !important;
            }
            .${ACTIVE_CLASS} {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                max-width: 100vw !important;
                max-height: 100vh !important;
                z-index: 2147483640 !important;
                background: #000 !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            .${ACTIVE_CLASS} video,
            video.${ACTIVE_CLASS} {
                width: 100% !important;
                height: 100% !important;
                max-width: 100% !important;
                max-height: 100% !important;
                object-fit: contain !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function reportActive() {
        postToGs3('FILL_PANEL_ACTIVE', { active: Boolean(activeContainer) });
    }

    function exitFillPanel() {
        activeContainer?.classList.remove(ACTIVE_CLASS);
        document.documentElement?.classList.remove(DOCUMENT_ACTIVE_CLASS);
        document.body?.classList.remove(DOCUMENT_ACTIVE_CLASS);
        activeContainer = null;
        activeVideo = null;
        if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
        savedScroll = null;
        reportActive();
        return true;
    }

    function enterFillPanel() {
        const player = findViablePlayer();
        if (!player) {
            exitFillPanel();
            return false;
        }
        ensureStyles();
        if (activeContainer && activeContainer !== player.container) {
            activeContainer.classList.remove(ACTIVE_CLASS);
        }
        if (!activeContainer) savedScroll = { x: window.scrollX, y: window.scrollY };
        activeContainer = player.container;
        activeVideo = player.video;
        document.documentElement?.classList.add(DOCUMENT_ACTIVE_CLASS);
        document.body?.classList.add(DOCUMENT_ACTIVE_CLASS);
        activeContainer.classList.add(ACTIVE_CLASS);
        reportActive();
        return true;
    }

    function toggleFillPanel() {
        return activeContainer ? exitFillPanel() : enterFillPanel();
    }

    function handleBridgeCommand(event) {
        if (window.self === window.top || event.source !== window.parent) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;
        if (data.source !== SOURCE || data.version !== VERSION || data.capability !== CAPABILITY) return;
        if (data.type === 'QUERY_CAPABILITY') {
            announceCapability();
        } else if (data.type === 'FILL_PANEL') {
            enterFillPanel();
        } else if (data.type === 'EXIT_FILL_PANEL') {
            exitFillPanel();
        }
    }

    function inspectDocument() {
        observerTimer = null;
        if (activeContainer && (!activeContainer.isConnected || !activeVideo?.isConnected)) {
            exitFillPanel();
        }
        announceCapability();
    }

    function scheduleInspection() {
        clearTimeout(observerTimer);
        observerTimer = setTimeout(inspectDocument, OBSERVER_DEBOUNCE_MS);
    }

    window.addEventListener('message', handleBridgeCommand);
    window.addEventListener('keydown', (event) => {
        if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.code !== 'KeyF') return;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
        if (!activeContainer && !findViablePlayer()) return;
        event.preventDefault();
        event.stopPropagation();
        toggleFillPanel();
    }, true);

    const start = () => {
        ensureStyles();
        inspectDocument();
        new MutationObserver(scheduleInspection).observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
