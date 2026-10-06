const plyrParams = {};
let video_player;
let isVerticalVideo;

$(document).ready(function () {
    isVerticalVideo = $('.video .video__video').hasClass('video-vertical');
    let play_button = $('#play_button');
    if (play_button.length > 0 && !play_button.data('dmca')) {
        play_button.click(play_button_pressed);
    }
});

$(window).blur(function(){
    if (video_player !== undefined) {
        video_player.pause();
    }
});


function play_button_pressed() {
    const $this = $(this);
    if ($this.data('loading')) {
        return;
    }
    $this.data('loading', '1');

    const id = $this.data('video-id');
    const token = $this.data('token');

    $.get("/api/video/" + id + "?token=" + token, function (data) {
        $this.removeData('loading');

        let splash = $('.video-splash-big');
        plyrParams.containerHeight = splash.height();
        splash.replaceWith(data);

        const plyr_container = $('#plyr_container');
        plyr_container.css('min-height', plyrParams.containerHeight + 'px');
        plyrParams.vtt = plyr_container.data('base64-vtt');
        plyrParams.markers = plyr_container.data('markers');

        init_video_player(id);
    });
}

function init_video_player(videoId) {
    if (typeof video_player !== 'undefined') {
        return;
    }

    if (localStorage.plyr) {
        const plyrSavedSettings = JSON.parse(localStorage.plyr);
        delete plyrSavedSettings.speed;
        localStorage.plyr = JSON.stringify(plyrSavedSettings);
    }

    const controls = plyrParams.type === 'tv' ? ['play', 'mute', 'volume', 'captions', 'fullscreen'] :
        isMobile() ?
            ['current-time', 'duration', 'mute', 'settings', 'fullscreen', 'progress'] :
            ['play', 'progress', 'current-time', 'mute', 'volume', 'settings', 'pip', 'fullscreen'];

    const markers = plyrParams.markers ?? [];

    const plyrSettings = {
        previewThumbnails: {
            enabled: (!!plyrParams.vtt),
            src: plyrParams.vtt
        },
        invertTime: false,
        controls: controls,
        fullscreen: {
            iosNative: true
        },
        seekTime: 10,
        autoplay: true,
        keyboard: {focused: true, global: true},
        speed: {
            selected: 1,
            options: [0.5, 0.75, 1, 1.25, 1.5, 2]
        },
        hideControls: !isMobile(),
        markers: {
            enabled: true,
            points: markers.map((sec) => ({time: sec, label: ""})),
        }
    };

    if (plyrParams.source) {
        plyrSettings.source = {
            type: 'video',
            sources: [{src: plyrParams.source, type: 'video/mp4'}],
            previewThumbnails: {
                enabled: (!!plyrParams.vtt),
                src: plyrParams.vtt
            }
        };
        createPlyr(plyrSettings, videoId);
    } else {
        const nsource = $('video.video-player source').attr('src');
        if (Hls.isSupported() && nsource.includes('.m3u8')) {
            const hls = new Hls();
            hls.loadSource(nsource);
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
                if (hls.levels.length > 1) {
                    const availableQualities = hls.levels.map((l) => l.height);
                    let defaultQuality = localStorage.videoQuality ?? Math.max(...availableQualities);
                    if (!availableQualities.includes(defaultQuality)) {
                        defaultQuality = availableQualities.reduce((prev, curr) => Math.abs(curr - defaultQuality) < Math.abs(prev - defaultQuality) ? curr : prev);
                    }
                    plyrSettings.quality = {
                        default: defaultQuality,
                        options: availableQualities,
                        forced: true,
                        onChange: (newQuality) => {
                            hls.levels.forEach((level, levelIndex) => {
                                if (level.height === newQuality) {
                                    hls.currentLevel = levelIndex;
                                }
                            });
                        }
                    };
                }

                createPlyr(plyrSettings, videoId);
            });

            hls.on(Hls.Events.ERROR, function(type, err) {
                if (err.type === 'networkError' && err.fatal) {
                    $('#video-loader').hide();
                    $('#video-unavailable').show();
                }
            });

            hls.attachMedia(document.querySelector('video.video-player'));
        } else {
            createPlyr(plyrSettings, videoId);
        }
    }

    return video_player;
}

function createPlyr(settings, videoId) {
    video_player = new Plyr('video.video-player', settings);

    $('#video-loader').show();
    $('.plyr__controls').hide();

    video_player.on('ready', () => {
        if (!isMobile()) {
            addWideScreenButton();
        }
    });

    if (isMobile()) {
        $('body').addClass('mobile');

        const CONTROLS_HIDE_TIMEOUT = 3000;

        let isStartingPlay = true;
        let isPinchZoom = false;
        let lastTap = 0;
        let tapTimer = null;
        let seekAccum = { timer: null, count: 0, direction: null };
        let controlsHideTimer = null;

        if (isIOS()) {
            let isInFullscreen = false;
            let shouldResumePlayback = false;

            $('video.video-box__video').on('webkitbeginfullscreen', function() {
                isInFullscreen = true;
                shouldResumePlayback = video_player.playing;
            });

            video_player.on('play', function() {
                if (isInFullscreen) {
                    shouldResumePlayback = true;
                }
            });

            video_player.on('pause', function() {
                if (isInFullscreen) {
                    setTimeout(() => {
                        if (isInFullscreen) {
                            shouldResumePlayback = false;
                        }
                    }, 100);
                }
            });

            $('video.video-box__video').on('webkitendfullscreen', function() {
                isInFullscreen = false;
                if (shouldResumePlayback) {
                    setTimeout(function() {
                        video_player.play()?.catch(() => {});
                    }, 500);
                }
            });
        }

        window.addEventListener('touchstart', function (event) {
            if (event.touches && event.touches.length > 1) {
                isPinchZoom = true;
            }
        });

        window.addEventListener('touchend', function (event) {
            if (!event.touches || event.touches.length === 0) {
                setTimeout(() => { isPinchZoom = false; }, 50);
            }
        });

        video_player.on('enterfullscreen', handleMobilePortraitFullscreen);
        video_player.on('exitfullscreen', handleMobilePortraitFullscreen);
        video_player.on('play', (event) => {
            onPlay(event, isStartingPlay);
            isStartingPlay = false;
        });
        video_player.on('pause', onPause);
        window.addEventListener('orientationchange', handleMobilePortraitFullscreen);

        video_player.on('pointerup', handleTap);

        video_player.eventListeners.forEach(function(listener) {
            if (listener.type === 'dblclick') {
                listener.element.removeEventListener(listener.type, listener.callback, listener.options);
            }
        });

        $('.plyr__controls').addClass('plyr__controls--mobile');

        function handleTap(event) {
            if (isPinchZoom) return;

            const currentTime = new Date().getTime();
            const timeSinceLastTap = currentTime - lastTap;
            const tapPosition = event.touches ? event.touches?.[0].pageX : event.pageX;
            const isControlsHidden = $('.plyr').hasClass('plyr--hide-controls');
            const isDoubleTap = timeSinceLastTap < 300 && timeSinceLastTap > 0;

            if (seekAccum.timer) {
                const isLeftSide = tapPosition < $(event.target).width() / 2;
                const tapDirection = isLeftSide ? 'backward' : 'forward';

                if (tapDirection === seekAccum.direction) {
                    clearTimeout(tapTimer);
                    lastTap = 0;
                    seekAccum.count++;
                    clearTimeout(seekAccum.timer);
                    const seekTime = video_player?.config?.seekTime ?? 10;
                    showOverlay(video_player, seekAccum.direction, null, seekTime * seekAccum.count);
                    seekAccum.timer = setTimeout(() => executeAccumulatedSeek(), 1000);
                    return;
                }
            }

            if (isDoubleTap) {
                clearTimeout(tapTimer);
                handleDoubleTap(tapPosition, event.target);
                lastTap = 0;
                return;
            }

            lastTap = currentTime;
            tapTimer = setTimeout(() => {
                handleSingleTap(event, isControlsHidden);
                lastTap = 0;
            }, 300);
        }

        function handleDoubleTap(tapPosition, target) {
            const isLeftSide = tapPosition < $(target).width() / 2;
            const direction = isLeftSide ? 'backward' : 'forward';
            const seekTime = video_player?.config?.seekTime ?? 10;

            if (seekAccum.direction && seekAccum.direction !== direction) {
                const wrapper = video_player?.elements?.wrapper;
                $(wrapper).find(`.player-overlay__${seekAccum.direction}`).remove();
            }

            clearTimeout(seekAccum.timer);
            seekAccum.count = 1;
            seekAccum.direction = direction;
            showOverlay(video_player, direction, null, seekTime);
            seekAccum.timer = setTimeout(() => executeAccumulatedSeek(), 1000);
        }

        function executeAccumulatedSeek() {
            const { count, direction } = seekAccum;
            const seekTime = video_player?.config?.seekTime ?? 10;
            const totalSeek = seekTime * count;

            if (direction === 'backward') {
                video_player.currentTime = Math.max(0, video_player.currentTime - totalSeek);
            } else {
                video_player.currentTime = Math.min(video_player.duration, video_player.currentTime + totalSeek);
            }

            showOverlay(video_player, direction, 500, totalSeek);
            seekAccum = { timer: null, count: 0, direction: null };
        }

        function handleSingleTap(event, isControlsHidden) {
            if (event.target.closest('.plyr__controls--mobile') && video_player.playing) {
                handleControlsHide();
                return;
            }

            if (!isControlsHidden) {
                togglePlayPause(event);
            } else {
                video_player.toggleControls(true);
                setTimeout(() => {
                    showOverlay(video_player, 'pause', null);
                }, 300);

                if (video_player.playing) {
                    handleControlsHide();
                }
            }
        }

        function togglePlayPause(event) {
            if (video_player.playing && $(event.target).closest('.player-overlay__pause').length) {
                onPause();
            }

            if (video_player.paused && $(event.target).closest('.player-overlay__play').length) {
                onPlay(event, true);
            }
        }

        function onPause() {
            video_player.pause();
            clearTimeout(controlsHideTimer);
            video_player.toggleControls(true);
            hideOverlay(video_player);
            showOverlay(video_player, 'play', null);
        }

        function onPlay(event, immediateControlsHide) {
            video_player.play()?.catch(() => {});
            hideOverlay(video_player);
            handleControlsHide(immediateControlsHide);
        }

        function handleControlsHide(immediate) {
            if (immediate) {
                clearTimeout(controlsHideTimer);
                video_player.toggleControls(false);
                hideOverlay(video_player);
                return;
            }

            if (controlsHideTimer) {
                clearTimeout(controlsHideTimer);
                controlsHideTimer = null;
            }

            controlsHideTimer = setTimeout(() => {
                video_player.toggleControls(false);
                hideOverlay(video_player);
                controlsHideTimer = null;
            }, CONTROLS_HIDE_TIMEOUT);
        }
    }

    function addWideScreenButton() {
        const controls = document.querySelector('.plyr__controls');

        const wideScreenButtonHTML = `
            <button class="plyr__controls__item plyr__control plyr__wide-screen">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="12" viewBox="0 0 20 10" fill="none" stroke="white" stroke-width="2">
                    <rect x="1" y="1" width="18" height="10" fill="none"/>
                </svg>
            </button>
        `;

        const fullscreenButton = controls.querySelector('.plyr__control[data-plyr="fullscreen"]');

        if (!fullscreenButton) return;

        fullscreenButton.insertAdjacentHTML('beforebegin', wideScreenButtonHTML);
        const wideScreenButton = document.querySelector('.plyr__wide-screen');
        wideScreenButton.addEventListener('click', () => {
            if (!$('.video').hasClass('full-width')) {
                const newVideoWidth = window.innerWidth - 80 >= ((window.innerHeight - 126) * (16 / 9))
                    ? ((window.innerHeight - 126) * (16 / 9))
                    : window.innerWidth - 80;

                const newVideoHeight = newVideoWidth * (9 / 16);

                document.documentElement.style.setProperty('--wide-video-width', `${newVideoWidth}px`);
                document.documentElement.style.setProperty('--wide-video-height', `${newVideoHeight}px`);
            }

            $('.video').toggleClass('full-width');
        });
    }

    function handleMobilePortraitFullscreen() {
        const isPortraitOrientation = window.screen?.orientation?.type?.includes('portrait');
        const hasOrientationAPI = window.screen?.orientation && typeof window.screen.orientation.lock === 'function';

        if (!hasOrientationAPI || isVerticalVideo) {
            return;
        }

        if (!video_player.fullscreen.active) {
            window.screen.orientation.unlock();
            return;
        }

        if (isPortraitOrientation) {
            window.screen.orientation.lock('landscape').catch((error) => {
                console.warn('Orientation lock failed:', error);
            });
        }
    }

    video_player.once('canplay', function () {
        $('.video-content-wrapper').attr('data-run', 'on');
        video_player?.play()?.catch(() => {});
        $('#plyr_container').css('min-height', '');
        $('#plyr_container video').css('display', 'block');
        $('#video-loader').hide();
        $('.plyr__controls').show();
    });

    timeline = new Timeline(video_player, $('#timeline'), $(window).width() > 640 ? 8 : 4);
}

function showOverlay(plyr, type, duration = 500, customSeekTime) {
    const wrapper = plyr?.elements?.wrapper;

    if (!wrapper || !type) return;

    const seekTime = customSeekTime ?? plyr?.config?.seekTime ?? 10;
    const overlayClass = `player-overlay__${type}`;

    $(wrapper).find(`.${overlayClass}`).remove();

    if (type === 'backward' || type === 'forward') {
        $(wrapper).append(`
            <div class="${overlayClass}">
                <i></i>
                <span>${type === 'backward' ? '-' : ''}${seekTime} seconds</span>
            </div>
        `);
    } else if (type === 'pause' || type === 'play') {
        $(wrapper).append(`
            <div class="${overlayClass}">
                <i></i>
            </div>
        `);
    } else {
        return;
    }

    if (duration) {
        setTimeout(() => {
            $(wrapper).find(`.${overlayClass}`).remove();
        }, duration);
    }
}

function hideOverlay(plyr) {
    const wrapper = plyr?.elements?.wrapper;

    if (!wrapper) return;

    $(wrapper).find('.player-overlay__play').remove();
    $(wrapper).find('.player-overlay__pause').remove();
}

function isMobile() {
    return /Mobi|Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
