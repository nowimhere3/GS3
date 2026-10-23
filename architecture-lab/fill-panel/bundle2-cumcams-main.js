$(document).ready(function () {
    $('#performer_search').on('keyup', function (event) {
        if (!allowed_key(event)) {
            return;
        }

        let input = $(event.target);
        if (!input.attr('searching')) {
            input.attr('searching', true);

            setTimeout(
                eval('performer_search_apply'),
                300,
                event
            );
        }
    });

    function performer_search_apply(e, min_search_text_length = 1) {
        let input = $(e.target);
        const search_text = input.val().trim().substring(0, SEARCH_MAX_LEN);

        const search_box_result_block = $('.header__search-result');
        search_box_result_block.html("");
        search_box_result_block.hide();

        if (
            (search_text.length >= min_search_text_length)
            || (search_text.startsWith('#') && search_text.length > 1)
        ) {
            let url = "/performers/search-suggest/" + encodeURIComponent(search_text);

            $.ajax({
                url: url,
                type: "post",
                success: function (response) {
                    if (e.keyCode === 13) {
                        let url = $($(response)[0]).find('a:first').attr('href');
                        if (url !== undefined) {
                            window.location.href = url;
                            return;
                        }
                    }

                    if (response.length > 0) {
                        search_box_result_block.html(response);
                        search_box_result_block.show();
                    }
                },
                error: function (xhr) {

                }
            });
        }

        input.removeAttr('searching');
    }

    $("#videoFile").change(function () {
        $('#videoFile').attr('disabled', true);

        let label = $('.modal__file-select');
        label.addClass('disabled').text(label.attr('data-text'));

        $('#videoUploadModal .loader').show();
        setTimeout(
            function () {
                $('#videoUploadModal .result').show();
            },
            7000
        );
        setTimeout(
            function () {
                window.location.href = '/';
            },
            10000
        );
    });

    let recentVideos = $('#recentVideos');
    if (recentVideos.length) {
        const url = recentVideos.data('url');

        $.ajax({
            url: url,
            success: (function (data) {
                if ('' === data.toString().trim()) {
                    $('.recent_videos').remove();
                    return;
                }

                recentVideos.html(data);
            }),
        });
    }

    let dmcaForm = $('#dmca-form');
    if (dmcaForm.length){
        document.querySelector('html').style.scrollBehavior='auto';

        dmcaForm.submit(function (e) {
            e.preventDefault();

            $(this).find('input[required], textarea[required]').each(function(){
                this.value = this.value.trim()
            });

            if (!this.reportValidity()){
                return;
            }

            let dmcaSendButton = $('#dmca-form button');
            let dmcaError = $('#dmca-form-error');

            dmcaSendButton.attr('disabled', true);

            $('.dmca-form-result').hide();

            dmcaError.hide();

            $.ajax({
                url: $(this).attr('action'),
                type: "post",
                data: $(this).serialize(),
                dataType: "json",
                success: function (response) {
                    if (response.result === 'success') {
                        $('.dmca-form-result').show();
                        $('#dmca-form').hide();
                        redirect_countdown($('.alert-message .countdown'), '/');
                    } else if (response.result === 'confirm') {
                        window.location.href = response.link;
                    } else {
                        if(response.error) {
                            dmcaError.html(response.error);
                        } else {
                            dmcaError.html(dmcaError.data('message'));
                        }
                        dmcaError.show();

                        if ($('#turnstile-cap').length) {
                            turnstile.reset('#turnstile-cap');
                        }

                        dmcaSendButton.removeAttr('disabled');
                    }
                },
            });
        });
    }


    let slider = $('.slider');
    if (slider.length) {
        let sliderWidth = 0;
        let itemWidth = 150;
        let animationSpeed = 400;

        let sliderWrapper = slider.find('.wrapper');
        let sliderItems = sliderWrapper.find('.items');
        let sliderNextButton = sliderWrapper.find('.next');
        let sliderPrevButton = sliderWrapper.find('.prev');

        let oldSliderWidth = parseInt(sliderWrapper.css('width').replace('px', ''));
        sliderItems.find('.item').each(function (idx, el) {
            sliderWidth += el.offsetWidth;
        });
        sliderItems.css('width', sliderWidth);

        sliderNextButton.on('click touch', function () {
            sliderItems.promise().done(function () {
                let left = -1 * parseInt(sliderItems.css('left').replace('px', ''));

                if (left + oldSliderWidth - itemWidth > sliderWidth + itemWidth) {
                    sliderItems.animate({left: "0px"}, animationSpeed);
                } else {
                    sliderItems.animate({left: "-=" + itemWidth + "px"}, animationSpeed);
                }
            });
        })

        sliderPrevButton.on('click touch', function () {
            let left = parseInt(sliderItems.css('left').replace('px', ''));

            if (left >= 0) {
                sliderItems.animate({left: "0px"}, animationSpeed);
            } else {
                sliderItems.animate({left: "+=" + itemWidth + "px"}, animationSpeed);
            }
        })
    }

    countdown($('.countdown_button'));
});

function allowed_key(e) {
    const allowed_code = [0, 8, 13, 32, 44, 45, 46, 95];
    const cc = (e.charCode) ? e.charCode : ((e.keyCode) ? e.keyCode : ((e.which) ? e.which : 0));

    return (
        allowed_code.indexOf(cc) > -1
        || (cc > 46 && cc < 91)
        || (cc > 95 && cc < 112)
        || (cc > 145)
    );
}

function countdown(n) {
    if (0 === n.length) {
        return;
    }

    let remainingTime = n.data('timeout');
    let span = n.find('span');
    remainingTime--;
    if (remainingTime <= 1) {
        span.text('');
        n.removeClass('btn--disabled').removeAttr('disabled');
    } else {
        n.data('timeout', remainingTime);
        let minutes = (remainingTime / 60) | 0;
        let seconds = (remainingTime % 60) | 0;
        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;
        span.text(minutes + ":" + seconds);
        setTimeout(function () {
            countdown(n);
        }, 1000);
    }
}

function redirect_countdown(n, url) {
    if (0 === n.length) {
        return;
    }

    let t = n.text();
    if (t <= 1) {
        window.location = url;
    } else {
        n.text(--t);
        setTimeout(function () {
            redirect_countdown(n, url);
        }, 1000);
    }
}

function confirmAge() {
    $('.modal.age').hide();
    $.post('/api/confirm-age',
        function () {
            $('.modal.age').hide();
        }
    );
}
