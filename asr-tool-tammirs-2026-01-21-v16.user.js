
// ==UserScript==
// @name              Andon_Survey_Reminder
// @version           2026-01-21-v16
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
    let autoCloseTimer = null;
    let widgetCheckTimer = null;
    let buttonWasClicked = false; // Flag to track if button was actually clicked
    const TWO_HOURS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

    // Add CSS animations
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
    `;
    document.head.appendChild(style);

    // Find the andon iframe
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

    // Create notification above iframe
    function createNotification() {
        // Only create notification if button was actually clicked
        if (!buttonWasClicked) return;
        if (document.getElementById('andon-survey-reminder')) return;

        const iframe = findAndonIframe();

        const notification = document.createElement('div');
        notification.id = 'andon-survey-reminder';
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

        // Calculate position based on iframe location
        let top, left, width;

        if (iframe && iframe.offsetParent !== null) {
            const rect = iframe.getBoundingClientRect();
            top = (rect.top + window.scrollY - 95) + 'px';
            left = (rect.left + window.scrollX) + 'px';
            width = rect.width + 'px';
        } else {
            top = '80px';
            left = '50%';
            width = '600px';
            notification.style.transform = 'translateX(-50%)';
        }

        Object.assign(notification.style, {
            position: 'absolute',
            top: top,
            left: left,
            width: width,
            backgroundColor: '#FFD700',
            color: '#000000',
            padding: '0',
            borderRadius: '6px',
            boxShadow: '0 6px 16px rgba(0,0,0,0.3)',
            zIndex: '10001',
            fontFamily: 'Arial, sans-serif',
            border: '3px solid #FFA500',
            boxSizing: 'border-box'
        });

        document.body.appendChild(notification);
        notificationActive = true;

        // Add button hover and click effects
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
                // Remove pulsing animation
                this.className = '';
                this.style.backgroundColor = '#28A745';
                this.style.cursor = 'default';
                this.disabled = true;

                // Create animated checkmark and text
                this.innerHTML = '<span class="check-icon">✓</span> <span class="completed-text">Survey Completed</span>';

                // Store acknowledgment flag
                GM_setValue('andon_survey_acknowledged', true);

                // Remove notification after 5 seconds
                setTimeout(function() {
                    removeNotification();
                }, 5000);
            });
        }

        // Set auto-close timer for 2 hours
        autoCloseTimer = setTimeout(function() {
            removeNotification();
        }, TWO_HOURS);
    }

    // Remove notification
    function removeNotification() {
        const notification = document.getElementById('andon-survey-reminder');
        if (notification) {
            notification.remove();
        }

        if (autoCloseTimer) {
            clearTimeout(autoCloseTimer);
            autoCloseTimer = null;
        }
        if (widgetCheckTimer) {
            clearInterval(widgetCheckTimer);
            widgetCheckTimer = null;
        }

        notificationActive = false;
        buttonWasClicked = false; // Reset flag
    }

    // Check if andon iframe is still visible
    function isAndonIframeVisible() {
        const iframe = findAndonIframe();
        if (!iframe) return false;

        const rect = iframe.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && iframe.offsetParent !== null;
    }

    // Monitor if iframe closes
    function monitorIframeClosure() {
        setTimeout(function() {
            widgetCheckTimer = setInterval(function() {
                if (notificationActive && !isAndonIframeVisible()) {
                    removeNotification();
                }
            }, 5000);
        }, 15000);
    }

    // Attach listener to Pull Andon Cord button
    function attachButtonListener() {
        document.addEventListener('click', function(event) {
            const target = event.target;

            const buttonText = target.textContent || target.innerText || '';
            if (buttonText.includes('Pull Andon Cord')) {
                // Set flag that button was clicked
                buttonWasClicked = true;

                setTimeout(function() {
                    createNotification();
                    monitorIframeClosure();
                }, 3000); // 3 second delay for iframe to load
                return;
            }

            // Check parent elements
            let parent = target.parentElement;
            for (let i = 0; i < 3; i++) {
                if (parent) {
                    const parentText = parent.textContent || parent.innerText || '';
                    if (parentText.includes('Pull Andon Cord') &&
                        (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button')) {
                        // Set flag that button was clicked
                        buttonWasClicked = true;

                        setTimeout(function() {
                            createNotification();
                            monitorIframeClosure();
                        }, 3000);
                        return;
                    }
                    parent = parent.parentElement;
                }
            }
        }, true);
    }

    // Initialize
    function init() {
        setTimeout(function() {
            attachButtonListener();
        }, 1000);
    }

    // Start when page is ready
    let currentUrl = window.location.href;
    if (currentUrl.includes('view-case')) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();

