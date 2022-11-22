/*****************************************
 * title: 진도체크 연동 스크립트 Case1
 * description: 표준 진도체크 스크립트
 *****************************************/

// 브라우저를 종료할 때 종료 시간 메세지 표시 여부
var showClosedConfirmMsg = true;

// 모바일에서 Unload 이벤트를 매 진도체크 요청마다 보낼지 여부
var useMobileUnloadEvent = true;

// 내부 처리용 변수
var isPlayedContent = false;		// 뷰어 초기 재생 상태
var isPlayerDeactivated = false; 	// 팝업 전체화면으로 등으로 인해 현재 콘테츠 재생 영역이 해제된 상태인지

var PlayState = {
		CLOSED: 0,
		OPENING: 1,
		BUFFERING: 2,
		PLAYING: 3,
		PAUSED: 4,
		STOPPED: 5
	};
	
var isMobile = function () {
	if( /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) ) {
		return true;
	}
	
	return false;
}
	
/** LMS 진도체크 대응 START **/
var TRACK_FORM = '<form id="track_form" style="display:none" method="post" action="[0]" target="[7]" >\
	<input type="text" name="state" value="[1]" />\
	<input type="text" name="duration" value="[2]" />\
	<input type="text" name="currentTime" value="[3]" />\
	<input type="text" name="cumulativeTime" value="[4]" />\
	<input type="text" name="page" value="[5]" />\
	<input type="text" name="totalpage" value="[6]" />\
	</form>';

var LMSState = {
		STOPPED: 1,
		PAUSED: 2,
		PLAYING: 3,
		BUFFERING: 6,
		UPDATE_DATA: 8,
		CONTENT_END: 10,
		UNLOAD: 99,
		UNLOAD_END: 100
	};

var lms_url = '';	// LMS 연동 주소 [Request/TargetUrl]
var gDataPostTimer;	// LMS에 메세지를 주기적으로 보내기 위한 Timer
var gDuration=0;	// 전체 콘텐츠 duration
var SEND_PLAYTIME_INTERVAL=3000;	// LMS에 메세지를 보낼 주기 (1분)
var play_time = 0;	// 현재 재생 시간 기록
var startat = 0;	// LMS 연동 시작 시간 [Request/startat]
var endat = 0;		// LMS 연동 Seek제한 시간 [Request/endat]
var isContentEnded; // 2021년 3월부터 갑자기 콘텐츠 끝도 아닌데 CONTENT_END 이벤트가 같은 시간에 1만~10만개까지 엄청나게 LMS 로그에 쌓이는 문제가 종종 보고되고 있어 조치하기 위함.
 
/** LMS 진도체크 대응 END **/

/* UniPlayer 초기 시작 이벤트 처리 */
function afterWinLoad() 
{
	isContentEnded = false;
	
	$('body').append("<iframe id='postLms' name='postLms' style='height:0;width:0%;border:0px'></iframe>");
	$('body').append("<iframe id='playingPostLms' name='playingPostLms' style='height:0;width:0%;border:0px'></iframe>");
	$('body').append("<iframe id='unloadPostLms' name='unloadPostLms' style='height:0;width:0%;border:0px'></iframe>");
	
	lms_url = Request('TargetUrl');
	play_time = Request('endat');
	startat = Request('startat');
	endat = Request('endat');
	
	if (typeof endat == 'undefined') {
		if (typeof startat != 'undefined') {
			play_time = startat;
		} else {
			play_time = -8888;
		}
	}

	// 브라우저 종료 시 시청 완료구간 안내 메세지는 진도체크 기능이 작동하는 경우에만 제한한다.
	if (lms_url.length <= 0) {
		showClosedConfirmMsg = false;
	}
}

/* [데스크톱 Only] UniPlayer 창이 닫힐때 이벤트 처리 */
function afterWinUnload() 
{
	sendPlayedTime(LMSState.UNLOAD, false);

	try {
		Pause();	
	}catch(e) {			
	}
	
	if (isShowClosedConfirmMsg()) {
		if (isPlayedContent) {
			var msg = GetStartTimeString(GetCumulativePlayedTime()) + "까지 시청하셨습니다.";						
			alert(msg);
		}
	}	
}

/* 목차 이동시 발생하는 이벤트 처리 */
function afterGotoSlide() 
{
	// 진도 체크를 위한 보완 측면에 추가함
	if(isPlayedContent){
		sendPlayedTime(LMSState.UPDATE_DATA, false);
		// Mobile에서는 UNLOAD 이벤트를 전달할 수 없기 때문에 추가로 한번 더 보낸다.
		if (useMobileUnloadEvent && isMobile()) {
			setTimeout(function() {sendPlayedTime(LMSState.UNLOAD, false);}, 100);
		}
	}
}

/* [데스크톱 Only] UniPlayer 창이 닫힐때 이벤트 처리 */
/* chrome은 반드시 return값이 존재해야만 window.onbeforeunload 이벤트가 발생하므로, 별도의 함수로 분리함. */
function afterChromeWinUnload() 
{
	// chrome에서는 form으로 보내면 정상적으로 데이터를 보내지 못하기 때문에 ajax로 보내도록 함
	sendPlayedTime(LMSState.UNLOAD, true);

	try {
		Pause();	
	}catch(e) {	
	}
	
	// chrome은 메세지를 임의로 출력할 수 없음
	if (isShowClosedConfirmMsg()) {
		var msg = GetStartTimeString(GetCumulativePlayedTime()) + "까지 시청하셨습니다.";
		return msg;
	}
}

/**
 * 팝업 전체화면 등으로 인해 현재 Player의 콘텐츠 재생 영역이 해제 되었을 때 
 */
function afterPlayerDeactivated() {
	isPlayerDeactivated = true;
	// 주기적으로 시청 완료 구간을 알리기 위한 타이머를 해제한다.
	if (gDataPostTimer) {
		clearInterval(gDataPostTimer);
		gDataPostTimer = null;
	}
}

/**
 * 팝업 전체화면 등으로 인해 현재 Player의 콘텐츠 재생 영역이 해제 된 것이 풀렸을 때
 */
function afterPlayerActivated() {
	isPlayerDeactivated = false;
	// 주기적으로 시청 완료 구간을 알리기 위한 타이머를 다시 구동한다.
	if (!gDataPostTimer) {
		gDataPostTimer = setInterval(function(){
			sendPlayedTime(LMSState.UPDATE_DATA, false);
			// Mobile에서는 UNLOAD 이벤트를 전달할 수 없기 때문에 추가로 한번 더 보낸다.
			if (useMobileUnloadEvent && isMobile()) {
				setTimeout(function() {sendPlayedTime(LMSState.UNLOAD, false);}, 100);
			}
		}, SEND_PLAYTIME_INTERVAL);
	}
}

/* 재생 상태 변경시 발생하는 이벤트 처리 */
function afterPlayStateChange(state)
{	
    // state 설명
    // 0 : closed (media 파일이 열리지 않은 상태)
    // 1 : opening (media 파일이 열리는 중)
    // 2 : buffering (버퍼링)
    // 3 : playing (media 재생)
    // 4 : paused (media 재생 일시정지)
    // 5 : stopped (media 재생 정지)

 	// console.log('[API]:afterPlayStateChange: ' + state);
	
	if (state == PlayState.PLAYING) setPlayedContent();
}

/* 시간 변화시 발생하는 이벤트 처리 */
/* 모바일 Seek 제한을 위한 처리가 포함되어 있음 */
function afterTimeUpdate()
{
	if ((lms_url.length > 0) && isMobile()) {
		var gDuration = GetTotalDuration();
		var cur_pos = GetCurrentTime();

		if (gDuration != endat)
		{		
			//프로그래스 검색 제어
			if (Math.abs(cur_pos-play_time) > 2 && cur_pos > play_time)
			{
				if (play_time == -9999 || play_time == -8888) return;	// -9999: 전 구간 시청 완료 처리, -8888: seek 제한 사용하지 않음
				SeekWithUpdateCumulativeTime(play_time);
			}
			else 
			{
				if (cur_pos > play_time) play_time = cur_pos;
			}
		}
	}
}

/* 콘텐츠 시청 종료시 발생하는 이벤트 */
function afterContentEnd()
{
	// 모두 시청완료 되었으므로 시청 완료된 구간(GetCumulativePlayedTime)이 아닌 총 콘텐츠 길이를 전달한다.
	clearInterval(gDataPostTimer);
	gDataPostTimer = null;

	setTimeout(function(){
		if (!isContentEnded) {
			isContentEnded = true;
			sendPlayedTime(LMSState.CONTENT_END);
		}
	}, 100);
}

/* IE의 winUnload 이벤트 연결 */
function setWinUnload() {
	var isInternetExplorer = navigator.appName.indexOf("Microsoft") != -1;
	if (isInternetExplorer) {
		version = parseFloat(navigator.appVersion.split("MSIE")[1]);
		if (version >= 9) {
			window.onbeforeunload = afterWinUnload;
		} else {
			window.onunload = afterWinUnload;
			window.onbeforeunload = afterWinUnload; // IE11의 호환성 보기 모드에서는 onunload가 동작하지 않기 때문에 onbeforeunload도 추가함
		}
	}
	else {
		window.onbeforeunload = afterWinUnload;
	}	
}

/* 최초 재생 시작시 초기화 처리 */
/* 사용자가 콘텐츠를 재생 했을 때만 종료 시에 종료 메시지를 띄우도록 처리함. */
function setPlayedContent() {
	if (lms_url.length <= 0) return;
	if (isPlayedContent) return;
	isPlayedContent = true;
	
	// 총 콘텐츠 길이를 저장해 둔다.
	gDuration = GetTotalDuration();
	sendPlayedTime(LMSState.PLAYING, false);

	// 주기적으로 시청 완료 구간을 알리기 위한 타이머를 구동한다.
	gDataPostTimer = setInterval(function(){
		sendPlayedTime(LMSState.UPDATE_DATA, false);
		// Mobile에서는 UNLOAD 이벤트를 전달할 수 없기 때문에 추가로 한번 더 보낸다.
		if (useMobileUnloadEvent && isMobile()) {
			setTimeout(function() {sendPlayedTime(LMSState.UNLOAD, false);}, 100);
		}
	}, SEND_PLAYTIME_INTERVAL);

	var is_chrome = /chrome/.test(navigator.userAgent.toLowerCase());
	if (!is_chrome) {
		setWinUnload();
		return;
	}

	window.onbeforeunload = afterChromeWinUnload;
}

/* 종료 메세지를 표시할 수 있는지 여부 판단 */
function isShowClosedConfirmMsg() {
	if (showClosedConfirmMsg == false) return false;	
	if (null != navigator.userAgent.match(/(iPad|iPhone)/i)) return false;
	if (null != navigator.userAgent.match(/(Android)/i)) return false;    
	return	true;
}

/* [LMS 연동 함수] 재생 정보 전달 */
function sendPlayedTime(lmsStatus, useAjax){
	var playedTime = GetCumulativePlayedTime();
	var curTime = GetCurrentTime();
	switch(lmsStatus) {
		case LMSState.PLAYING:
			mod_xncommons_track(lmsStatus, curTime, playedTime, useAjax);
			break;

		case LMSState.UPDATE_DATA:
			mod_xncommons_track(lmsStatus, curTime, playedTime, useAjax);
			break;
			
		case LMSState.UNLOAD:
			mod_xncommons_track(lmsStatus, curTime, playedTime, useAjax);
			break;
			
		case LMSState.CONTENT_END:
			mod_xncommons_track(lmsStatus, gDuration, gDuration, useAjax);
			break;

		case LMSState.UNLOAD_END:
			mod_xncommons_track(LMSState.UNLOAD_END, gDuration, gDuration, useAjax);
			break;
	}
}

/* [LMS 연동 함수] 재생 정보 전달 */
function mod_xncommons_track(lmsstate, curPos, cumulativeTime, useAjax) {
	if (isPlayerDeactivated) return;
	if (lms_url.length <= 0) return;
	
	var page = GetCurrentPage();
	var total_page = GetTotalPage();
	curPos = Math.round(curPos*1000)/1000;
	cumulativeTime = Math.round(cumulativeTime*1000)/1000;

	// 모바일에서 seek를 했을 때 curPos이 크게 나올 수 있기 때문에 처리한다.
	if (curPos > cumulativeTime && Math.abs(curPos - cumulativeTime) > 2) return;

	// 시간을 얻는 타이밍에 따라 curPos이 크게 나오는 경우 같은 값으로 처리한다.
	if (curPos > cumulativeTime) curPos = cumulativeTime;

	if (useAjax) {
		$.ajax({
			type: 'POST',
			url: lms_url,
			data: {
				state: lmsstate,
				duration: gDuration,
				currentTime: curPos,
				cumulativeTime: cumulativeTime,
				page: page,
				totalpage: total_page
			}
		});
		return;
	}
	
	if (document.getElementById('track_form')) $('#track_form').remove();
		
	var formTarget = "postLms";
	switch(lmsstate) {
		case LMSState.PLAYING:
			formTarget = "playingPostLms";
			break;
		case LMSState.UNLOAD:
			formTarget = "unloadPostLms";
			break;
	}
	
	var lms_form_track = format(TRACK_FORM, 
			lms_url,
			lmsstate,
			gDuration,
			curPos,
			cumulativeTime,
			page,
			total_page,
			formTarget
		);

	$track_form = $(lms_form_track);
	$('body').append($track_form);
	$('#track_form').submit();
}

/**
 * 스트링 포메팅
 * 첫 번째 인자는 치환되기 전의 문자열이며 [n] 형태의 문자열을 포함하고 있다. (n는 0 이상의 정수)
 * 이 함수는 첫 번째 인자의 [n]이 n+1번째 인자로 치환된 결과를 반환한다.
 * 
 * 예) xn_common.format('Hello, [0]', 'Cheol') === 'Hello, Cheol'
 */
function format(str) {
	// TODO: underscore의 template()처럼 컴파일된 녀석을 반환
	var safe,
		arg,
		args = Array.prototype.slice.call(arguments, 1),
		len = args.length;

	for (var i = 0; i < len; i++) {
		arg = args[i];
		safe = typeof arg === 'object' ? JSON.stringify(arg) : arg;
		str = str.replace(RegExp('\\['+i+'\\]', 'g'), safe);
	}
	return str;
}

function isUndefined( variable ) { return ( (variable == null || variable == "" || typeof(variable) == "undefined" )) }

//Request [GET]
function Request(valuename)
{
	var rtnval = "";
	var nowAddress = location.search;
	var parameters = new Array();
	parameters = (nowAddress.slice(nowAddress.indexOf("?")+1,nowAddress.length)).split("&");
	for(var i = 0 ; i < parameters.length ; i++) {
		if(parameters[i].indexOf(valuename) != -1) {
			rtnval = parameters[i].split("=")[1];
			if (isUndefined(rtnval)) rtnval = "";
			rtnval = decodeURIComponent(rtnval);
			break;
		}
	}
	return rtnval;
}

// 초 단위를 사람이 인식할 수 있는 시:분:초 형태로 변환한다.
function GetStartTimeString(startTime)
{
	var rtnStringTime = "";
	
	if (startTime >= 3600) //Hour
	{
		rtnStringTime += Math.floor(startTime / 3600)  + "시 " ;
		startTime -= Math.floor(startTime / 3600) * 3600;
	}

	if (startTime >= 60) //minute
	{
		rtnStringTime += Math.floor(startTime / 60) + "분 ";
		startTime -= Math.floor(startTime / 60) * 60;
	}
	
	//seconds	
	startTime = Math.round(startTime*100)/100;

	rtnStringTime += startTime;

	if (rtnStringTime.indexOf(".") != -1)
	{
		rtnStringTime =  rtnStringTime.substring(0, rtnStringTime.indexOf("."));
	}
	rtnStringTime += "초";
	
	return rtnStringTime;
}
