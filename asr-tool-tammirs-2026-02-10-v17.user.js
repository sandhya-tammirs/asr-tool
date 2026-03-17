// ==UserScript==
// @name              Andon_Survey_Reminder
// @version           2026-02-10-v22
// @author            Sandhya Tammireddy
// @run-at            document-idle
// @description       Floating notification to remind associates to complete andon satisfaction survey
// @match             https://paragon-eu.amazon.com/hz/view-case*
// @match             https://paragon-fe.amazon.com/hz/view-case*
// @match             https://paragon-na.amazon.com/hz/view-case*
// @grant             GM_setValue
// @grant             GM_getValue
// @namespace         http://tampermonkey.net/
// ==/UserScript==

(function() {
    'use strict';

    let notificationActive = false;
    let widgetCheckTimer = null;
    let iframePollTimer = null;
    let iframeResizeObserver = null;
    let buttonWasClicked = false;
    let consecutiveFailures = 0;
    const IFRAME_POLL_INTERVAL = 500;
    const IFRAME_POLL_TIMEOUT = 15000;
    const CLOSURE_CHECK_INTERVAL = 1000;
    const CLOSURE_INITIAL_DELAY = 5000;
    const CONSECUTIVE_FAILURES_REQUIRED = 2;
    const THANK_YOU_DISPLAY_TIME = 2000;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes ring {
            0%, 100% { transform: rotate(0deg); }
            10% { transform: rotate(15deg); }
            20% { transform: rotate(-15deg); }
            30% { transform: rotate(10deg); }
            40% { transform: rotate(-10deg); }
            50% { transform: rotate(0deg); }
        }
        @keyframes buttonPulseGlow {
            0%, 100% {
                box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 0 rgba(108,117,125,0);
            }
            50% {
                box-shadow: 0 4px 8px rgba(0,0,0,0.3), 0 0 15px rgba(108,117,125,0.6);
            }
        }
        @keyframes drawCheck {
            0% {
                content: '';
                opacity: 0;
            }
            30% {
                content: '✓';
                opacity: 1;
                transform: scale(0.5);
            }
            100% {
                content: '✓';
                opacity: 1;
                transform: scale(1);
            }
        }
        @keyframes fadeInText {
            0% {
                opacity: 0;
                transform: translateX(-10px);
            }
            100% {
                opacity: 1;
                transform: translateX(0);
            }
        }
        .andon-bell-icon {
            animation: ring 2s ease-in-out infinite;
            display: inline-block;
            font-size: 28px;
            filter: drop-shadow(0 0 8px rgba(255, 107, 107, 0.8))
                    drop-shadow(0 0 4px rgba(0, 0, 0, 0.6));
        }
        .survey-button-pending {
            animation: buttonPulseGlow 2s ease-in-out infinite;
        }
        .check-icon {
            display: inline-block;
            animation: drawCheck 0.5s ease-out forwards;
        }
        .completed-text {
            display: inline-block;
            animation: fadeInText 0.5s ease-out 0.3s forwards;
            opacity: 0;
        }
        #andon-survey-reminder {
            background-color: #FFD700;
            color: #000000;
            padding: 0;
            border-radius: 6px;
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
            z-index: 10001;
            font-family: Arial, sans-serif;
            border: 3px solid #FFA500;
            box-sizing: border-box;
            margin-bottom: 5px;
        }
    `;
    document.head.appendChild(style);

    // -------------------------------------------------------
    // Helper: collect only the SHALLOW text of an element
    // -------------------------------------------------------
    function getShallowText(element) {
        if (!element) return '';
        let text = '';
        element.childNodes.forEach(function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if (['span', 'b', 'i', 'em', 'strong', 'label', 'svg', 'img'].includes(tag)) {
                    text += node.textContent;
                }
            }
        });
        return text.trim();
    }

    // -------------------------------------------------------
    // Given a click-event target, decide whether the actual
    // "Pull Andon Cord" button was the one that was clicked.
    // -------------------------------------------------------
    function isAndonButtonClick(target) {
        const btn = target.closest('button, [role="button"]');
        if (!btn) return false;

        const btnText = getShallowText(btn);
        if (btnText.includes('Pull Andon Cord')) return true;

        if (!btn.querySelector('button, [role="button"]')) {
            const fullText = (btn.textContent || '').trim();
            if (fullText.includes('Pull Andon Cord')) return true;
        }

        return false;
    }

    function findAndonIframe() {
        const iframes = document.querySelectorAll('iframe');
        for (let iframe of iframes) {
            const src = iframe.src || '';
            if (src.includes('andon-cord.selling-partner-support.amazon.dev')) {
                return iframe;
            }
        }
        return null;
    }

    function isAndonIframeVisible() {
        const iframe = findAndonIframe();
        if (!iframe) return false;

        const rect = iframe.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && iframe.offsetParent !== null;
    }

    // -------------------------------------------------------
    // Watch the iframe for size changes and sync the
    // notification width to match.
    // -------------------------------------------------------
    function startResizeObserver(iframe) {
        if (iframeResizeObserver) {
            iframeResizeObserver.disconnect();
        }

        iframeResizeObserver = new ResizeObserver(function(entries) {
            const notification = document.getElementById('andon-survey-reminder');
            if (!notification) return;

            for (let entry of entries) {
                const newWidth = entry.contentRect.width;
                if (newWidth > 0) {
                    notification.style.width = newWidth + 'px';
                }
            }
        });

        iframeResizeObserver.observe(iframe);
    }

    function stopResizeObserver() {
        if (iframeResizeObserver) {
            iframeResizeObserver.disconnect();
            iframeResizeObserver = null;
        }
    }

    function createNotification() {
        if (!buttonWasClicked) return;
        if (document.getElementById('andon-survey-reminder')) return;
        if (!isAndonIframeVisible()) return;

        const iframe = findAndonIframe();
        if (!iframe || !iframe.parentElement) return;

        const notification = document.createElement('div');
        notification.id = 'andon-survey-reminder';
        notification.style.width = iframe.offsetWidth + 'px';
        notification.innerHTML = `
            <div style="padding: 15px 20px; display: flex; align-items: center; gap: 15px;">
                <div class="andon-bell-icon">🔔</div>
                <div style="flex: 1;">
                    <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: #1a1a1a;">
                        Andon Survey Reminder
                    </div>
                    <div style="font-size: 16px; font-weight: 700; line-height: 1.5; color: #000000;">
                        Thank you for using andon support! Please complete the andon survey to share your experience.
                    </div>
                </div>
                <button id="survey-completed-btn" class="survey-button-pending" style="
                    background-color: #6C757D;
                    color: #FFFFFF;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 4px;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    font-family: Arial, sans-serif;
                    white-space: nowrap;
                    flex-shrink: 0;
                    transition: background-color 0.2s;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                ">Confirm Survey Completion</button>
            </div>
        `;

        // Insert directly before the iframe in the DOM
        iframe.parentElement.insertBefore(notification, iframe);
        notificationActive = true;

        // Start watching iframe for size changes
        startResizeObserver(iframe);

        const button = document.getElementById('survey-completed-btn');
        if (button) {
            button.addEventListener('mouseenter', function() {
                if (this.style.backgroundColor === 'rgb(108, 117, 125)') {
                    this.style.backgroundColor = '#5A6268';
                }
            });
            button.addEventListener('mouseleave', function() {
                if (this.style.backgroundColor === 'rgb(90, 98, 104)') {
                    this.style.backgroundColor = '#6C757D';
                }
            });
            button.addEventListener('click', function() {
                this.className = '';
                this.style.backgroundColor = '#28A745';
                this.style.cursor = 'default';
                this.disabled = true;

                this.innerHTML = '<span class="check-icon">✓</span> <span class="completed-text">Thank you</span>';

                GM_setValue('andon_survey_acknowledged', true);

                setTimeout(function() {
                    removeNotification();
                }, THANK_YOU_DISPLAY_TIME);
            });
        }
    }

    function removeNotification() {
        const notification = document.getElementById('andon-survey-reminder');
        if (notification) {
            notification.remove();
        }

        if (widgetCheckTimer) {
            clearInterval(widgetCheckTimer);
            widgetCheckTimer = null;
        }
        if (iframePollTimer) {
            clearInterval(iframePollTimer);
            iframePollTimer = null;
        }

        stopResizeObserver();

        notificationActive = false;
        buttonWasClicked = false;
        consecutiveFailures = 0;
    }

    // -------------------------------------------------------
    // Monitor iframe closure with consecutive failure check.
    // Requires 2 consecutive failures (2 seconds) before
    // removing — prevents false closures from brief flickers.
    // Starts 5 seconds after notification appears to let
    // the widget fully stabilize.
    // -------------------------------------------------------
    function monitorIframeClosure() {
        setTimeout(function() {
            widgetCheckTimer = setInterval(function() {
                if (!notificationActive) return;

                if (!isAndonIframeVisible()) {
                    consecutiveFailures++;

                    if (consecutiveFailures >= CONSECUTIVE_FAILURES_REQUIRED) {
                        removeNotification();
                    }
                } else {
                    // Iframe is visible — reset failure count
                    consecutiveFailures = 0;
                }
            }, CLOSURE_CHECK_INTERVAL);
        }, CLOSURE_INITIAL_DELAY);
    }

    // -------------------------------------------------------
    // Poll for the Andon iframe instead of a fixed delay.
    // Only creates the notification once the iframe is
    // confirmed visible. If it never appears, nothing shows.
    // -------------------------------------------------------
    function waitForIframeAndShow() {
        let elapsed = 0;

        iframePollTimer = setInterval(function() {
            elapsed += IFRAME_POLL_INTERVAL;

            if (isAndonIframeVisible()) {
                clearInterval(iframePollTimer);
                iframePollTimer = null;

                createNotification();
                monitorIframeClosure();
                return;
            }

            if (elapsed >= IFRAME_POLL_TIMEOUT) {
                clearInterval(iframePollTimer);
                iframePollTimer = null;
                buttonWasClicked = false;
            }
        }, IFRAME_POLL_INTERVAL);
    }

    // -------------------------------------------------------
    // Click handler — uses closest() + shallow-text check
    // so only the real button triggers the reminder.
    // -------------------------------------------------------
    function attachButtonListener() {
        document.addEventListener('click', function(event) {
            if (notificationActive || buttonWasClicked) return;

            if (isAndonButtonClick(event.target)) {
                buttonWasClicked = true;
                waitForIframeAndShow();
            }
        }, true);
    }

    function init() {
        setTimeout(function() {
            attachButtonListener();
        }, 1000);
    }

    let currentUrl = window.location.href;
    if (currentUrl.includes('view-case')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
