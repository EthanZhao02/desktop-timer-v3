function showError(msg) {
  var errEl = document.getElementById("errorDisplay");
  if (errEl) {
    errEl.textContent = "错误: " + msg;
    errEl.style.display = "block";
    console.error(msg);
  }
}

// ==================== 欢迎页逻辑 ====================
(function setupWelcome() {
  var overlay = document.getElementById("welcomeOverlay");
  if (!overlay) return;

  var WELCOME_KEY = "zhiyu-welcomed-v1";
  // 首次启动才弹（用 localStorage 标记）
  try {
    if (localStorage.getItem(WELCOME_KEY) === "1") return;
  } catch (e) {}

  // 延迟一点弹，等主窗口动画结束
  setTimeout(function() {
    overlay.classList.add("show");
  }, 600);

  var step = 0;
  var steps = overlay.querySelectorAll(".welcome-step");
  var dots = overlay.querySelectorAll(".welcome-dot");
  var btnNext = document.getElementById("welcomeNext");
  var btnPrev = document.getElementById("welcomePrev");
  var btnSkip = document.getElementById("welcomeSkip");

  function render() {
    for (var i = 0; i < steps.length; i++) {
      steps[i].className = (i === step) ? "welcome-step active" : "welcome-step";
    }
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = (i === step) ? "welcome-dot active" : "welcome-dot";
    }
    btnPrev.classList.toggle("is-hidden", step === 0);
    btnNext.textContent = (step === steps.length - 1) ? "开始使用" : "下一步 →";
  }

  function close(persist) {
    overlay.classList.remove("show");
    if (persist) {
      try { localStorage.setItem(WELCOME_KEY, "1"); } catch (e) {}
    }
  }

  btnNext.onclick = function() {
    if (step < steps.length - 1) {
      step++;
      render();
    } else {
      close(true);
    }
  };
  btnPrev.onclick = function() {
    if (step > 0) { step--; render(); }
  };
  btnSkip.onclick = function() { close(true); };

  // ESC 也关闭
  document.addEventListener("keydown", function(e) {
    if (overlay.classList.contains("show") && e.key === "Escape") {
      close(true);
    }
  });
})();

window.onerror = function(msg, url, line, col, error) {
  showError(msg + " (行 " + line + ")");
  return false;
};

try {
  // ==================== 全局变量 ====================
  var countdownInterval = null;
  var countdownRunning = false;
  var timerInterval = null;
  var timerStartTime = 0;
  var timerElapsed = 0;
  var timerRunning = false;
  var lapCount = 0;
  var laps = [];  // 计次数据
  var alarms = [];
  var editingAlarmId = null;
  var focusSessions = [];
  var currentAudio = null;  // 当前播放的音频
  var currentToneContext = null;
  var musicLaunchQueued = false;
  var activeRingingAlarm = null;
  var alarmCameraStream = null;
  var alarmFallbackCode = "";
  var faceLandmarker = null;
  var faceDetectionFrame = 0;
  var faceDetectionBusy = false;
  var blinkSawOpenEyes = false;
  var blinkVerified = false;

  function setPetActivity(state, source, options) {
    if (!window.api || !window.api.setPetActivity) return;
    var payload = {
      state: state,
      source: source || 'timer',
      restoreState: options && options.restoreState ? options.restoreState : 'idle'
    };
    if (options && options.duration) payload.duration = options.duration;
    window.api.setPetActivity(payload);
  }

  function syncPetWorkState(source) {
    setPetActivity(timerRunning || countdownRunning ? 'work' : 'idle', source || 'timer');
  }
  var currentMusicMode = '';
  var currentPlaybackCanLaunchMusic = false;
  var playbackSequence = 0;
  var customRingtoneData = null;
  var customRingtoneName = "";
  var ringtoneLibrary = [];  // 铃声库列表
  var defaultRingtoneSrc = null;

  // ==================== DOM 元素 ====================
  var el = {
    currentDate: document.getElementById("currentDate"),
    currentTime: document.getElementById("currentTime"),
    countdownDisplay: document.getElementById("countdownDisplay"),
    countdownLabel: document.getElementById("countdownLabel"),
    clearCountdownBtn: document.getElementById("clearCountdownBtn"),
    timerDisplay: document.getElementById("timerDisplay"),
    timerMs: document.getElementById("timerMs"),
    timerState: document.getElementById("timerState"),
    alarmList: document.getElementById("alarmList"),
    lapList: document.getElementById("lapList"),
    notification: document.getElementById("notification"),
    warningPanel: document.getElementById("warningPanel"),
    warningMessage: document.getElementById("warningMessage"),
    warningCloseBtn: document.getElementById("warningCloseBtn"),
    ringtoneName: document.getElementById("ringtoneName"),
    audioControl: document.getElementById("audioControl"),
    audioStatus: document.getElementById("audioStatus"),
    alarmVerificationOverlay: document.getElementById("alarmVerificationOverlay"),
    ringingAlarmTime: document.getElementById("ringingAlarmTime"),
    ringingAlarmTitle: document.getElementById("ringingAlarmTitle"),
    alarmVerificationHint: document.getElementById("alarmVerificationHint"),
    alarmCameraPanel: document.getElementById("alarmCameraPanel"),
    alarmCameraVideo: document.getElementById("alarmCameraVideo"),
    alarmCameraCanvas: document.getElementById("alarmCameraCanvas"),
    alarmCameraStatus: document.getElementById("alarmCameraStatus"),
    alarmFallbackPanel: document.getElementById("alarmFallbackPanel"),
    alarmFallbackCode: document.getElementById("alarmFallbackCode"),
    alarmFallbackInput: document.getElementById("alarmFallbackInput"),
    retryAlarmCameraBtn: document.getElementById("retryAlarmCameraBtn"),
    verifyAlarmStopBtn: document.getElementById("verifyAlarmStopBtn"),
    directAlarmStopBtn: document.getElementById("directAlarmStopBtn"),
    clearLapsBtn: document.getElementById("clearLapsBtn"),
    autoStartSetting: document.getElementById("autoStartSetting"),
    keepAliveSetting: document.getElementById("keepAliveSetting"),
    petAlwaysOnTopSetting: document.getElementById("petAlwaysOnTopSetting"),
    musicOnAlarmSetting: document.getElementById("musicOnAlarmSetting"),
    musicAppSelect: document.getElementById("musicAppSelect"),
    musicAppPathBtn: document.getElementById("musicAppPathBtn"),
    musicAppStatus: document.getElementById("musicAppStatus"),
    testMusicAppBtn: document.getElementById("testMusicAppBtn"),
    quitAppBtn: document.getElementById("quitAppBtn"),
    dataPathInfo: document.getElementById("dataPathInfo"),
    versionInfo: document.getElementById("versionInfo"),
    openDataFolderBtn: document.getElementById("openDataFolderBtn")
  };

  // ==================== 工具函数 ====================
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function localDayKey(timestamp) {
    var date = new Date(timestamp);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function renderFocusSummary() {
    var today = localDayKey(Date.now());
    var todaySessions = focusSessions.filter(function(session) {
      return session && localDayKey(session.completedAt) === today;
    });
    var totalMs = todaySessions.reduce(function(total, session) {
      return total + Number(session.duration || 0);
    }, 0);
    var minutes = Math.floor(totalMs / 60000);
    var timeEl = document.getElementById('todayFocusTime');
    var countEl = document.getElementById('todayFocusCount');
    if (timeEl) timeEl.textContent = minutes >= 60
      ? Math.floor(minutes / 60) + '小时' + (minutes % 60 ? minutes % 60 + '分' : '')
      : minutes + '分钟';
    if (countEl) countEl.textContent = todaySessions.length + '次';
  }

  async function recordFocusSession(duration) {
    if (duration < 60000) return;
    var session = { duration: Math.round(duration), completedAt: Date.now() };
    if (window.api && window.api.addFocusSession) {
      focusSessions = await window.api.addFocusSession(session) || focusSessions.concat(session);
    } else {
      focusSessions.push(session);
    }
    renderFocusSummary();
  }

  function showNotification(msg) {
    el.notification.textContent = msg;
    el.notification.className = "notification show";
    setTimeout(function() {
      el.notification.className = "notification";
    }, 2500);
  }

  function showAppWarning(warning) {
    var message = (warning && warning.message) || "应用状态需要注意";
    if (!el.warningPanel || !el.warningMessage) {
      showNotification(message);
      return;
    }
    el.warningMessage.textContent = message;
    el.warningPanel.classList.remove("is-hidden");
  }

  function setupWarningPanel() {
    if (!el.warningCloseBtn || !el.warningPanel) return;
    el.warningCloseBtn.onclick = function() {
      el.warningPanel.classList.add("is-hidden");
    };
    window.addEventListener("app-warning", function(e) {
      showAppWarning(e.detail);
    });
  }

  function readLocalJson(key, fallback) {
    try {
      var saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function getLocalString(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  async function loadSavedData() {
    var localAlarms = readLocalJson("desktopTimerAlarms", []);
    var localLaps = readLocalJson("desktopTimerLaps", []);
    var localRingtone = getLocalString("customRingtone");
    var localRingtoneName = getLocalString("customRingtoneName");
    var migrationDone = getLocalString("zhiyu-json-migration-v1") === "1";

    if (window.api && window.api.getAlarms) {
      var savedAlarms = await window.api.getAlarms();
      alarms = Array.isArray(savedAlarms) ? savedAlarms : [];
      if (!migrationDone && alarms.length === 0 && localAlarms.length > 0) {
        alarms = localAlarms;
        await window.api.setAlarms(localAlarms);
      }
    } else {
      alarms = localAlarms;
    }

    if (window.api && window.api.getLaps) {
      var savedLaps = await window.api.getLaps();
      laps = Array.isArray(savedLaps) ? savedLaps : [];
      if (!migrationDone && laps.length === 0 && localLaps.length > 0) {
        laps = localLaps;
        await window.api.setLaps(localLaps);
      }
    } else {
      laps = localLaps;
    }
    lapCount = laps.length;

    if (window.api && window.api.getRingtone) {
      var savedRingtone = await window.api.getRingtone();
      customRingtoneData = savedRingtone && savedRingtone.src ? savedRingtone.src : null;
      customRingtoneName = savedRingtone && savedRingtone.name ? savedRingtone.name : "";
      if (!migrationDone && !customRingtoneData && localRingtone) {
        customRingtoneData = localRingtone;
        customRingtoneName = localRingtoneName;
        await window.api.setRingtone({ src: localRingtone, name: localRingtoneName });
      }
    } else {
      customRingtoneData = localRingtone;
      customRingtoneName = localRingtoneName;
    }

    if (window.api && window.api.getDefaultRingtonePath) {
      defaultRingtoneSrc = await window.api.getDefaultRingtonePath();
    }
    if (window.api && !migrationDone) {
      try {
        localStorage.removeItem("desktopTimerAlarms");
        localStorage.removeItem("desktopTimerLaps");
        localStorage.removeItem("customRingtone");
        localStorage.removeItem("customRingtoneName");
        localStorage.setItem("zhiyu-json-migration-v1", "1");
      } catch (e) {}
    }
  }

  function notifySystem(title, body) {
    if (window.api && window.api.showNotification) {
      window.api.showNotification({ title: title, body: body });
    }
  }

  // ==================== 时钟 ====================
  function updateDateTime() {
    var now = new Date();
    var weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    el.currentDate.textContent = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() + "日 " + weekdays[now.getDay()];
    el.currentTime.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
  }

  // ==================== 标签切换 ====================
  function setupTabs() {
    var btns = document.querySelectorAll(".tab-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = (function(btn) {
        return function() {
          var tabId = btn.getAttribute("data-tab");
          var allBtns = document.querySelectorAll(".tab-btn");
          for (var j = 0; j < allBtns.length; j++) allBtns[j].className = "tab-btn";
          var allContents = document.querySelectorAll(".tab-content");
          for (var j = 0; j < allContents.length; j++) allContents[j].className = "tab-content";
          btn.className = "tab-btn active";
          document.getElementById(tabId).className = "tab-content active";
        };
      })(btns[i]);
    }
  }

  // 供主进程托盘「新建闹钟」远程切换标签
  window.activateTabById = function(tabId) {
    var target = document.querySelector('.tab-btn[data-tab="' + tabId + '"]');
    if (!target) return;
    var allBtns = document.querySelectorAll(".tab-btn");
    for (var j = 0; j < allBtns.length; j++) allBtns[j].className = "tab-btn";
    var allContents = document.querySelectorAll(".tab-content");
    for (var j = 0; j < allContents.length; j++) allContents[j].className = "tab-content";
    target.className = "tab-btn active";
    document.getElementById(tabId).className = "tab-content active";
  };

  if (window.api && window.api.onSwitchTab) {
    window.api.onSwitchTab(function(tab) { window.activateTabById(tab); });
  }

  // ==================== 倒计时 ====================
  var LEGACY_COUNTDOWN_LABELS = ["考研", "考公", "过年", "上班"];

  function clearCountdown(clearInputs) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
    countdownRunning = false;
    el.countdownDisplay.textContent = "00:00:00";
    el.countdownLabel.textContent = "设置倒计时";
    el.countdownLabel.className = "countdown-label";
    el.countdownDisplay.className = "countdown-value";
    if (el.clearCountdownBtn) el.clearCountdownBtn.classList.add("is-hidden");
    if (clearInputs) {
      document.getElementById("customDate").value = "";
      document.getElementById("customLabel").value = "";
    }
    if (window.api && window.api.setCountdown) window.api.setCountdown(null);
    syncPetWorkState('countdown-clear');
  }

  function startCountdown(targetDate, label) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownRunning = true;
    setPetActivity('work', 'countdown');
    el.countdownLabel.textContent = "距离 " + label + " 还有";
    el.countdownLabel.className = "countdown-label pulse";
    el.countdownDisplay.className = "countdown-value pulse";
    if (el.clearCountdownBtn) el.clearCountdownBtn.classList.remove("is-hidden");

    // 持久化倒计时状态
    if (window.api && window.api.setCountdown) {
      window.api.setCountdown({ targetDate: targetDate.toISOString(), label: label });
    }

    function renderCountdown() {
      var now = new Date();
      var diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        countdownRunning = false;
        el.countdownDisplay.textContent = "时间到！";
        el.countdownLabel.textContent = label;
        el.countdownLabel.className = "countdown-label";
        el.countdownDisplay.className = "countdown-value";
        if (el.clearCountdownBtn) el.clearCountdownBtn.classList.add("is-hidden");
        playRingtone();
        showNotification(label + " 到了！");
        notifySystem("倒计时提醒", label + " 到了！");
        // 清除已过期倒计时
        if (window.api && window.api.setCountdown) {
          window.api.setCountdown(null);
        }
        setPetActivity('celebrate', 'countdown-complete', {
          duration: 8000,
          restoreState: timerRunning ? 'work' : 'idle'
        });
        return;
      }

      var days = Math.floor(diff / (1000 * 60 * 60 * 24));
      var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      var seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        el.countdownDisplay.textContent = days + "天 " + pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
      } else {
        el.countdownDisplay.textContent = pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
      }
    }

    renderCountdown();
    countdownInterval = setInterval(renderCountdown, 1000);
  }

  function setupCountdown() {
    document.getElementById("startCountdownBtn").onclick = function() {
      var dateInput = document.getElementById("customDate").value;
      var label = document.getElementById("customLabel").value || "自定义事件";

      if (!dateInput) {
        showNotification("请先选择日期和时间");
        return;
      }

      var target = new Date(dateInput);
      if (target < new Date()) {
        showNotification("请选择未来的时间");
        return;
      }

      startCountdown(target, label);
    };

    if (el.clearCountdownBtn) {
      el.clearCountdownBtn.onclick = function() {
        clearCountdown(true);
      };
    }
  }

  // ==================== 正计时 ====================
  function updateTimer() {
    timerElapsed = Date.now() - timerStartTime;
    var totalSeconds = Math.floor(timerElapsed / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var ms = timerElapsed % 1000;
    el.timerDisplay.textContent = pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
    el.timerMs.textContent = "." + ("00" + ms).slice(-3);
  }

  function setTimerState(state) {
    if (!el.timerState) return;
    el.timerState.className = "timer-state";
    if (state === "running") {
      el.timerState.className = "timer-state running";
      el.timerState.textContent = "运行中";
    } else if (state === "paused") {
      el.timerState.className = "timer-state paused";
      el.timerState.textContent = "已暂停";
    } else {
      el.timerState.textContent = "准备就绪";
    }
  }

  function saveLaps() {
    try {
      if (window.api && window.api.setLaps) window.api.setLaps(laps);
      else localStorage.setItem("desktopTimerLaps", JSON.stringify(laps));
    } catch (e) {
      showNotification("保存失败：计次数据可能太多");
    }
  }

  function renderLaps() {
    el.lapList.replaceChildren();
    if (laps.length === 0) {
      el.clearLapsBtn.classList.add("is-hidden");
      el.lapList.classList.add("is-hidden");
      return;
    }
    el.lapList.classList.remove("is-hidden");
    for (var i = laps.length - 1; i >= 0; i--) {
      var lap = laps[i];
      var item = document.createElement("div");
      item.className = "lap-item";

      var info = document.createElement("div");
      info.className = "lap-info";

      var label = document.createElement("span");
      label.className = "lap-label";
      label.textContent = "计次 " + Number(lap.index);

      var time = document.createElement("span");
      time.className = "lap-time";
      time.textContent = lap.time || "";

      var deleteButton = document.createElement("button");
      deleteButton.className = "lap-delete";
      deleteButton.title = "删除此计次";
      deleteButton.textContent = "✕";
      deleteButton.onclick = (function(index) {
        return function() { deleteLap(index); };
      })(i);

      info.append(label, time);
      item.append(info, deleteButton);
      el.lapList.appendChild(item);
    }
    el.clearLapsBtn.classList.remove("is-hidden");
  }

  function deleteLap(index) {
    laps.splice(index, 1);
    // 重新编号
    for (var i = 0; i < laps.length; i++) {
      laps[i].index = i + 1;
    }
    lapCount = laps.length;
    saveLaps();
    renderLaps();
    showNotification("已删除该计次");
  }

  function clearAllLaps() {
    if (laps.length === 0) return;
    if (!confirm("确定清空所有计次吗？")) return;
    laps = [];
    lapCount = 0;
    saveLaps();
    renderLaps();
    showNotification("已清空所有计次");
  }

  function setupTimer() {
    var startBtn = document.getElementById("startTimerBtn");
    var pauseBtn = document.getElementById("pauseTimerBtn");
    var resetBtn = document.getElementById("resetTimerBtn");
    var lapBtn = document.getElementById("lapBtn");

    startBtn.onclick = function() {
      if (!timerRunning) {
        timerStartTime = Date.now() - timerElapsed;
        timerInterval = setInterval(updateTimer, 10);
        timerRunning = true;
        startBtn.textContent = "运行中";
        startBtn.disabled = true;
        pauseBtn.disabled = false;
        lapBtn.disabled = false;
        setTimerState("running");
        if (window.api && window.api.setStopwatch) {
          window.api.setStopwatch({ elapsed: timerElapsed, running: true, startTime: timerStartTime });
        }
        setPetActivity('work', 'stopwatch');
      }
    };

    pauseBtn.onclick = function() {
      if (timerRunning) {
        clearInterval(timerInterval);
        timerRunning = false;
        startBtn.textContent = "继续";
        startBtn.disabled = false;
        pauseBtn.disabled = true;
        setTimerState("paused");
        if (window.api && window.api.setStopwatch) {
          window.api.setStopwatch({ elapsed: timerElapsed, running: false });
        }
        syncPetWorkState('stopwatch-pause');
      }
    };

    resetBtn.onclick = function() {
      var completedDuration = timerElapsed;
      clearInterval(timerInterval);
      timerRunning = false;
      timerElapsed = 0;
      el.timerDisplay.textContent = "00:00:00";
      el.timerMs.textContent = ".000";
      startBtn.textContent = "开始";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      lapBtn.disabled = true;
      setTimerState("ready");
      if (window.api && window.api.setStopwatch) {
        window.api.setStopwatch(null);
      }
      syncPetWorkState('stopwatch-reset');
      recordFocusSession(completedDuration);
    };

    lapBtn.onclick = function() {
      if (timerRunning) {
        if (laps.length >= 99) {
          showNotification("最多支持 99 圈计次");
          return;
        }
        lapCount++;
        var lapTime = el.timerDisplay.textContent + el.timerMs.textContent;
        laps.push({
          index: lapCount,
          time: lapTime,
          timestamp: Date.now()
        });
        saveLaps();
        renderLaps();
      }
    };

    el.clearLapsBtn.onclick = clearAllLaps;
  }

  function stopAlarmCamera() {
    if (faceDetectionFrame) cancelAnimationFrame(faceDetectionFrame);
    faceDetectionFrame = 0;
    faceDetectionBusy = false;
    if (alarmCameraStream) {
      alarmCameraStream.getTracks().forEach(function(track) { track.stop(); });
      alarmCameraStream = null;
    }
    if (el.alarmCameraVideo) el.alarmCameraVideo.srcObject = null;
  }

  function hideAlarmVerification() {
    stopAlarmCamera();
    activeRingingAlarm = null;
    alarmFallbackCode = "";
    if (el.alarmFallbackInput) el.alarmFallbackInput.value = "";
    if (el.alarmVerificationOverlay) el.alarmVerificationOverlay.classList.add("is-hidden");
  }

  function completeAlarmStop() {
    stopCurrentAudio();
    finishRingtonePlayback();
    hideAlarmVerification();
    showNotification("闹钟已停止");
  }

  function showAlarmFallback(message) {
    stopAlarmCamera();
    alarmFallbackCode = String(Math.floor(1000 + Math.random() * 9000));
    el.alarmCameraPanel.classList.add("is-hidden");
    el.alarmFallbackPanel.classList.remove("is-hidden");
    el.alarmFallbackCode.textContent = alarmFallbackCode;
    el.alarmVerificationHint.textContent = message || "摄像头不可用，请使用备用验证";
    el.verifyAlarmStopBtn.textContent = "验证并停止";
    el.verifyAlarmStopBtn.disabled = false;
    el.alarmFallbackInput.focus();
  }

  function describeCameraError(error) {
    var name = error && error.name;
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "摄像头被其他程序占用或硬件隐私开关已关闭，请关闭占用程序后重试";
    }
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "摄像头权限被拒绝，请在 Windows 隐私设置中允许桌面应用访问摄像头";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "没有检测到可用摄像头，请检查设备连接";
    }
    if (name === "OverconstrainedError") {
      return "摄像头不支持当前画面参数，请重试";
    }
    return "无法使用摄像头，请检查设备和系统权限后重试";
  }

  function blendshapeScore(categories, name) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].categoryName === name) return Number(categories[i].score) || 0;
    }
    return 0;
  }

  async function getFaceLandmarker() {
    if (faceLandmarker) return faceLandmarker;
    if (!window.Vision || !window.Vision.FilesetResolver || !window.Vision.FaceLandmarker) {
      throw new Error("mediapipe-unavailable");
    }
    var mediaPipeBase = new URL("assets/mediapipe/", window.location.href).href.replace(/\/$/, "");
    var modelUrl = new URL("assets/mediapipe/face_landmarker.task", window.location.href).href;
    var fileset = await window.Vision.FilesetResolver.forVisionTasks(mediaPipeBase);
    faceLandmarker = await window.Vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: modelUrl,
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
    return faceLandmarker;
  }

  function runBlinkDetection() {
    if (!alarmCameraStream || blinkVerified) return;
    faceDetectionFrame = requestAnimationFrame(runBlinkDetection);
    if (faceDetectionBusy || el.alarmCameraVideo.readyState < 2) return;
    faceDetectionBusy = true;
    try {
      var result = faceLandmarker.detectForVideo(el.alarmCameraVideo, performance.now());
      var shapes = result.faceBlendshapes && result.faceBlendshapes[0];
      if (!shapes || !shapes.categories) {
        el.alarmCameraStatus.textContent = "未检测到人脸，请正对摄像头";
        return;
      }
      var left = blendshapeScore(shapes.categories, "eyeBlinkLeft");
      var right = blendshapeScore(shapes.categories, "eyeBlinkRight");
      if (!blinkSawOpenEyes) {
        if (left < 0.3 && right < 0.3) {
          blinkSawOpenEyes = true;
          el.alarmCameraStatus.textContent = "已检测到人脸，请眨一次眼";
        } else {
          el.alarmCameraStatus.textContent = "请睁眼并正对摄像头";
        }
        return;
      }
      if (left > 0.52 && right > 0.52) {
        blinkVerified = true;
        el.alarmCameraStatus.textContent = "眨眼验证成功，可以停止闹钟";
        el.alarmVerificationHint.textContent = "已确认是真人操作，照片不会保存或上传";
        el.verifyAlarmStopBtn.textContent = "停止闹钟";
        el.verifyAlarmStopBtn.disabled = false;
      }
    } catch (error) {
      showAlarmFallback("人脸检测运行失败，请使用备用验证码");
    } finally {
      faceDetectionBusy = false;
    }
  }

  async function startAlarmCamera() {
    el.alarmCameraPanel.classList.remove("is-hidden");
    el.alarmFallbackPanel.classList.add("is-hidden");
    el.alarmCameraStatus.textContent = "正在请求摄像头权限...";
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("camera-unavailable");
      alarmCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      el.alarmCameraVideo.srcObject = alarmCameraStream;
      await el.alarmCameraVideo.play();
      el.alarmCameraStatus.textContent = "正在加载本地人脸检测模型...";
      await getFaceLandmarker();
      el.alarmCameraStatus.textContent = "请睁眼并正对摄像头";
      runBlinkDetection();
    } catch (error) {
      console.error("[Alarm verification] camera failed:", error && error.name, error && error.message);
      showAlarmFallback(describeCameraError(error));
    }
  }

  function showAlarmVerification(alarm) {
    activeRingingAlarm = alarm || { label: "闹钟", time: "" };
    var needsPhoto = activeRingingAlarm.requirePhotoVerification === true;
    el.ringingAlarmTime.textContent = activeRingingAlarm.time || "闹钟";
    el.ringingAlarmTitle.textContent = activeRingingAlarm.label || "闹钟";
    el.alarmVerificationOverlay.classList.remove("is-hidden");
    el.verifyAlarmStopBtn.classList.toggle("is-hidden", !needsPhoto);
    el.directAlarmStopBtn.classList.toggle("is-hidden", needsPhoto);
    el.alarmFallbackPanel.classList.add("is-hidden");
    if (needsPhoto) {
      blinkSawOpenEyes = false;
      blinkVerified = false;
      el.alarmVerificationHint.textContent = "检测到人脸并完成一次眨眼后才能停止";
      el.verifyAlarmStopBtn.textContent = "完成眨眼后停止";
      el.verifyAlarmStopBtn.disabled = true;
      startAlarmCamera();
    } else {
      el.alarmCameraPanel.classList.add("is-hidden");
      el.alarmVerificationHint.textContent = "点击按钮停止本次闹钟";
    }
  }

  async function verifyPhotoAndStopAlarm() {
    if (!activeRingingAlarm) return;
    if (!el.alarmFallbackPanel.classList.contains("is-hidden")) {
      if (el.alarmFallbackInput.value.trim() !== alarmFallbackCode) {
        el.alarmVerificationHint.textContent = "验证码不正确，请重新输入";
        el.alarmFallbackInput.select();
        return;
      }
      completeAlarmStop();
      return;
    }
    if (!blinkVerified) return;
    completeAlarmStop();
  }

  function setupAlarmVerification() {
    el.verifyAlarmStopBtn.onclick = verifyPhotoAndStopAlarm;
    el.directAlarmStopBtn.onclick = completeAlarmStop;
    el.retryAlarmCameraBtn.onclick = function() {
      blinkSawOpenEyes = false;
      blinkVerified = false;
      el.verifyAlarmStopBtn.disabled = true;
      el.verifyAlarmStopBtn.textContent = "完成眨眼后停止";
      startAlarmCamera();
    };
    el.alarmFallbackInput.onkeydown = function(event) {
      if (event.key === "Enter") verifyPhotoAndStopAlarm();
    };
  }

  // ==================== 闹钟 ====================
  function saveAlarms() {
    try {
      if (window.api && window.api.setAlarms) window.api.setAlarms(alarms);
      else localStorage.setItem("desktopTimerAlarms", JSON.stringify(alarms));
    } catch (e) {}
  }

  function renderAlarms() {
    el.alarmList.replaceChildren();
    if (alarms.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-tip";
      empty.textContent = "暂无闹钟，点击上方添加";
      el.alarmList.appendChild(empty);
      return;
    }
    for (var i = 0; i < alarms.length; i++) {
      var a = alarms[i];
      var item = document.createElement("div");
      item.className = "alarm-item";

      var info = document.createElement("div");
      info.className = "alarm-info";

      var time = document.createElement("div");
      time.className = "alarm-time";
      time.textContent = a.time || "";

      var label = document.createElement("div");
      label.className = "alarm-label-text";
      var labelText = (a.label || "") + (a.repeat ? " · 每天" : "");
      if (a.ringtone || a.musicMode || a.requirePhotoVerification) {
        var tags = [];
        if (a.ringtone) {
          var rt = ringtoneLibrary.find(r => r.key === a.ringtone);
          tags.push("[铃声]" + (rt ? rt.name : "自定义"));
        }
        if (a.musicMode) tags.push("[场景]" + a.musicMode);
        if (a.requirePhotoVerification) tags.push("[拍照验证]");
        labelText += "  " + tags.join("  ");
      }
      label.textContent = labelText;

      var actions = document.createElement("div");
      actions.className = "alarm-actions";

      var toggle = document.createElement("button");
      toggle.className = "alarm-toggle" + (a.enabled ? " active" : "");
      toggle.type = "button";
      toggle.title = a.enabled ? "停用闹钟" : "启用闹钟";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", a.enabled ? "true" : "false");
      toggle.onclick = (function(id) {
        return function() { toggleAlarm(id); };
      })(Number(a.id));

      var editButton = document.createElement("button");
      editButton.className = "edit-alarm";
      editButton.type = "button";
      editButton.title = "编辑闹钟";
      editButton.textContent = "编辑";
      editButton.onclick = (function(id) {
        return function() { editAlarm(id); };
      })(Number(a.id));

      var deleteButton = document.createElement("button");
      deleteButton.className = "delete-alarm";
      deleteButton.type = "button";
      deleteButton.title = "删除闹钟";
      deleteButton.textContent = "✕";
      deleteButton.onclick = (function(id) {
        return function() { deleteAlarm(id); };
      })(Number(a.id));

      info.append(time, label);
      actions.append(toggle, editButton, deleteButton);
      item.append(info, actions);
      el.alarmList.appendChild(item);
    }
  }

  function toggleAlarm(id) {
    for (var i = 0; i < alarms.length; i++) {
      if (alarms[i].id === id) {
        alarms[i].enabled = !alarms[i].enabled;
        alarms[i].triggered = false;
        break;
      }
    }
    saveAlarms();
    renderAlarms();
  }

  function deleteAlarm(id) {
    var newAlarms = [];
    for (var i = 0; i < alarms.length; i++) {
      if (alarms[i].id !== id) newAlarms.push(alarms[i]);
    }
    alarms = newAlarms;
    saveAlarms();
    renderAlarms();
    showNotification("闹钟已删除");
  }

  function resetAlarmForm() {
    editingAlarmId = null;
    document.getElementById("alarmTime").value = "";
    document.getElementById("alarmLabel").value = "";
    document.getElementById("repeatDaily").checked = false;
    document.getElementById("alarmPhotoVerification").checked = false;
    document.getElementById("alarmMusicMode").value = "";
    document.getElementById("alarmRingtone").value = "";
    document.getElementById("addAlarmBtn").textContent = "添加闹钟";
    document.getElementById("cancelAlarmEditBtn").classList.add("is-hidden");
  }

  function editAlarm(id) {
    var alarm = alarms.find(function(item) { return Number(item.id) === Number(id); });
    if (!alarm) return;
    editingAlarmId = Number(alarm.id);
    document.getElementById("alarmTime").value = alarm.time || "";
    document.getElementById("alarmLabel").value = alarm.label || "";
    document.getElementById("repeatDaily").checked = !!alarm.repeat;
    document.getElementById("alarmPhotoVerification").checked = !!alarm.requirePhotoVerification;
    document.getElementById("alarmMusicMode").value = alarm.musicMode || "";
    document.getElementById("alarmRingtone").value = alarm.ringtone || "";
    document.getElementById("addAlarmBtn").textContent = "保存修改";
    document.getElementById("cancelAlarmEditBtn").classList.remove("is-hidden");
    document.getElementById("alarmTime").focus();
  }

  function setupAlarm() {
    document.getElementById("addAlarmBtn").onclick = function() {
      var timeInput = document.getElementById("alarmTime").value;
      var labelInput = document.getElementById("alarmLabel").value;
      var repeat = document.getElementById("repeatDaily").checked;
      var requirePhotoVerification = document.getElementById("alarmPhotoVerification").checked;

      if (!timeInput) {
        showNotification("请选择闹钟时间");
        return;
      }

      var modeSelect = document.getElementById("alarmMusicMode");
      var modeInput = modeSelect.disabled ? "" : modeSelect.value;
      var ringtoneInput = document.getElementById("alarmRingtone").value;
      var alarm = {
        id: editingAlarmId || Date.now(),
        time: timeInput,
        label: labelInput || "闹钟",
        repeat: repeat,
        requirePhotoVerification: requirePhotoVerification,
        enabled: true,
        triggered: false,
        musicMode: modeInput || '',
        ringtone: ringtoneInput || ''
      };

      if (editingAlarmId) {
        alarms = alarms.map(function(item) {
          return Number(item.id) === editingAlarmId ? alarm : item;
        });
      } else {
        alarms.push(alarm);
      }
      saveAlarms();
      renderAlarms();

      var wasEditing = editingAlarmId !== null;
      resetAlarmForm();
      showNotification(wasEditing ? "闹钟已更新：" + alarm.time : "闹钟已添加：" + alarm.time);
    };
    document.getElementById("cancelAlarmEditBtn").onclick = resetAlarmForm;
  }

  function checkAlarms() {
    if (window.api && window.api.getAlarms) return;
    var now = new Date();
    var currentTime = pad(now.getHours()) + ":" + pad(now.getMinutes());
    for (var i = 0; i < alarms.length; i++) {
      var alarm = alarms[i];
      if (alarm.enabled && alarm.time === currentTime && !alarm.triggered) {
        alarm.triggered = true;
        currentMusicMode = alarm.musicMode || '';
        currentPlaybackCanLaunchMusic = true;
        if (alarm.ringtone) {
          var rt = ringtoneLibrary.find(r => r.key === alarm.ringtone);
          playRingtone(rt ? rt.src : null, { source: 'alarm', musicMode: currentMusicMode, alarm: alarm });
        } else {
          playRingtone(null, { source: 'alarm', musicMode: currentMusicMode, alarm: alarm });
        }
        showNotification(alarm.label);
        if (!alarm.repeat) {
          alarm.enabled = false;
          saveAlarms();
          renderAlarms();
        } else {
          (function(a) {
            setTimeout(function() { a.triggered = false; }, 60000);
          })(alarm);
        }
      }
    }
  }

  // ==================== 铃声（修复版：支持完整播放）====================
  function getPlayMode() {
    var radios = document.querySelectorAll('input[name="playMode"]');
    for (var i = 0; i < radios.length; i++) {
      if (radios[i].checked) return radios[i].value;
    }
    return "full";
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
      currentAudio = null;
    }
    if (currentToneContext) {
      try { currentToneContext.close(); } catch (e) {}
      currentToneContext = null;
    }
    el.audioControl.className = "audio-control";
    if (window._audioTimeout) {
      clearTimeout(window._audioTimeout);
      window._audioTimeout = null;
    }
    if (window._audioStopTimeout) {
      clearTimeout(window._audioStopTimeout);
      window._audioStopTimeout = null;
    }
  }

  // 起床听歌：铃声播放结束后自动打开所选音乐应用（可按闹钟指定汽水场景）
  function maybeLaunchMusic(mode) {
    if (musicLaunchQueued) return;
    musicLaunchQueued = true;
    if (!el.musicOnAlarmSetting || !el.musicOnAlarmSetting.checked) return;
    if (!window.api || !window.api.openMusicApp) return;
    window.api.openMusicApp({ musicMode: mode || '' }).then(function(res) {
      if (!res) return;
      if (res.success) {
        if (res.modeSelected) {
          showNotification("已打开汽水音乐，进入" + (mode || "起床") + "模式");
        } else {
          showNotification(res.alreadyRunning ? "音乐应用已在运行，开始播放" : "已打开音乐应用，开始播放");
        }
      } else if (res.reason === "not-found") {
        showNotification("未找到音乐应用，请在设置中选择");
      } else if (res.reason === "launch-failed") {
        showNotification("音乐应用启动失败");
      }
    });
  }

  function finishRingtonePlayback(playbackId) {
    if (playbackId !== undefined && playbackId !== playbackSequence) return;
    if (currentPlaybackCanLaunchMusic) maybeLaunchMusic(currentMusicMode);
  }

  function playRingtone(src, options) {
    // 停止之前的声音
    stopCurrentAudio();
    musicLaunchQueued = false;
    currentPlaybackCanLaunchMusic = !!(options && options.source === 'alarm');
    currentMusicMode = options && options.musicMode ? options.musicMode : '';
    var ringingAlarm = options && options.alarm ? options.alarm : null;
    var requiresVerification = !!(ringingAlarm && ringingAlarm.requirePhotoVerification);
    if (ringingAlarm) showAlarmVerification(ringingAlarm);
    var playbackId = ++playbackSequence;

    var mode = requiresVerification ? "manual" : getPlayMode();
    var playSrc = src || customRingtoneData || defaultRingtoneSrc;
    console.log("[Audio] playRingtone called, mode=" + mode + ", hasSrc=" + !!playSrc + ", srcLen=" + (playSrc ? playSrc.length : 0));
    el.audioStatus.textContent = "正在播放...";
    el.audioControl.className = "audio-control show";

    // 先恢复 AudioContext（Electron 自动播放策略可能暂停音频）
    try {
      var resumeCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (resumeCtx.state === "suspended") {
        resumeCtx.resume();
      }
      resumeCtx.close();
    } catch (e) {
      console.warn("[Audio] AudioContext resume failed:", e);
    }

    if (playSrc) {
      try {
        currentAudio = new Audio(playSrc);
        currentAudio.volume = 0.8;
        currentAudio.loop = mode === "manual";
        console.log("[Audio] Audio element created, attempting play...");

        currentAudio.onended = function() {
          el.audioStatus.textContent = "✓ 播放完毕";
          finishRingtonePlayback(playbackId);
          setTimeout(function() {
            el.audioControl.className = "audio-control";
          }, 2000);
        };

        currentAudio.onerror = function() {
          el.audioStatus.textContent = "✗ 播放错误，使用默认提示音";
          playDefaultSound(mode, playbackId);
        };

        currentAudio.play().catch(function(err) {
          el.audioStatus.textContent = "播放失败";
          console.error("[Audio] play() failed:", err.message, err.name);
          playDefaultSound(mode, playbackId);
        });

        // 根据模式设置停止时间
        if (mode === "30s") {
          window._audioTimeout = setTimeout(function() {
            stopCurrentAudio();
            finishRingtonePlayback(playbackId);
          }, 30000);
        } else if (mode === "60s") {
          window._audioTimeout = setTimeout(function() {
            stopCurrentAudio();
            finishRingtonePlayback(playbackId);
          }, 60000);
        }
        // "full" 播放完整音频，"manual" 循环直到手动停止

      } catch (e) {
        playDefaultSound(mode, playbackId);
      }
    } else {
      playDefaultSound(mode, playbackId);
    }
  }

  function playDefaultSound(mode, playbackId) {
    if (playbackId !== playbackSequence) return;
    try {
      console.log("[Audio] playDefaultSound called, mode=" + mode);
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      currentToneContext = audioCtx;
      if (audioCtx.state === "suspended") audioCtx.resume();
      var oscillator = audioCtx.createOscillator();
      var gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
      oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime + 0.3);
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime + 0.6);
      oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime + 0.9);
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 2);
      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 2);

      el.audioStatus.textContent = "✓ 提示音播放完毕";
      if (mode === "30s" || mode === "60s" || mode === "manual") {
        window._audioTimeout = setTimeout(function() {
          playDefaultSound(mode, playbackId);
        }, 2200);
        if ((mode === "30s" || mode === "60s") && !window._audioStopTimeout) {
          window._audioStopTimeout = setTimeout(function() {
            stopCurrentAudio();
            finishRingtonePlayback(playbackId);
          }, mode === "30s" ? 30000 : 60000);
        }
      } else {
        setTimeout(function() {
          el.audioControl.className = "audio-control";
        }, 2500);
        setTimeout(function() { finishRingtonePlayback(playbackId); }, 2000);
      }
    } catch (e) {}
  }

  async function loadRingtoneLibrary() {
    try {
      if (window.api && window.api.getRingtoneLibrary) {
        ringtoneLibrary = await window.api.getRingtoneLibrary() || [];
      }
    } catch (e) {
      ringtoneLibrary = [];
    }
    var sel = document.getElementById("alarmRingtone");
    if (sel) {
      var cur = sel.value;
      sel.innerHTML = '<option value="">默认铃声</option>';
      for (var i = 0; i < ringtoneLibrary.length; i++) {
        var opt = document.createElement("option");
        opt.value = ringtoneLibrary[i].key;
        opt.textContent = ringtoneLibrary[i].name;
        sel.appendChild(opt);
      }
      sel.value = cur;
    }
    // 渲染设置里的铃声库列表
    var listEl = document.getElementById("ringtoneLibraryList");
    if (listEl) {
      listEl.innerHTML = "";
      if (ringtoneLibrary.length === 0) {
        listEl.textContent = "铃声库为空，点下面按钮添加";
      } else {
        for (var i = 0; i < ringtoneLibrary.length; i++) {
          var item = document.createElement("div");
          item.className = "ringtone-library-item";
          var nameEl = document.createElement("span");
          nameEl.className = "name";
          nameEl.textContent = ringtoneLibrary[i].name;
          var delBtn = document.createElement("button");
          delBtn.className = "btn btn-small btn-danger";
          delBtn.textContent = "删除";
          delBtn.onclick = (function(key) {
            return async function() {
              if (window.api && window.api.removeRingtoneFromLibrary) {
                await window.api.removeRingtoneFromLibrary(key);
                await loadRingtoneLibrary();
                renderAlarms();
              }
            };
          })(ringtoneLibrary[i].key);
          item.append(nameEl, delBtn);
          listEl.appendChild(item);
        }
      }
    }
  }

  function setupRingtone() {
    // 添加铃声到库
    var addBtn = document.getElementById("addRingtoneBtn");
    if (addBtn) {
      addBtn.onclick = async function() {
        if (!window.api || !window.api.addRingtoneToLibrary) return;
        var res = await window.api.addRingtoneToLibrary();
        if (res && res.ok) {
          showNotification("已添加：" + res.ringtone.name);
          await loadRingtoneLibrary();
        } else if (res && res.canceled) {
          // 取消
        } else if (res && res.error === "too-large") {
          showNotification("铃声太大，最大 100MB");
        } else {
          showNotification("添加失败");
        }
      };
    }

    document.getElementById("selectRingtoneBtn").onclick = async function() {
      if (!window.api || !window.api.pickRingtoneFile) {
        showNotification("当前版本不支持，请重启程序");
        return;
      }
      try {
        var res = await window.api.pickRingtoneFile();
        if (res && res.canceled) return;
        if (res && res.ok) {
          customRingtoneData = res.src;
          customRingtoneName = res.name || "自定义铃声";
          el.ringtoneName.textContent = "已选择: " + customRingtoneName;
          showNotification("铃声已更换，播放闹钟时会使用");
          return;
        }
        if (res && res.error === "too-large") {
          showNotification("铃声文件太大，请选择不超过 100MB 的文件");
        } else if (res && res.error === "bad-format") {
          showNotification("请选择 WAV 或 MP3 铃声文件");
        } else {
          showNotification("铃声设置失败，请重试");
        }
      } catch (err) {
        showNotification("铃声设置失败，请重试");
      }
    };

    // 显示已选择的铃声
    if (customRingtoneData && customRingtoneName) {
      el.ringtoneName.textContent = "已选择: " + customRingtoneName;
    }

    // 停止按钮：手动停止铃声 = 铃声结束，同样触发起床听歌
    document.getElementById("stopAudioBtn").onclick = function() {
      if (activeRingingAlarm && activeRingingAlarm.requirePhotoVerification) {
        showAlarmVerification(activeRingingAlarm);
        return;
      }
      stopCurrentAudio();
      finishRingtonePlayback();
      hideAlarmVerification();
    };
  }

  async function setupSettings() {
    if (!window.api || !window.api.getSettings) {
      el.autoStartSetting.disabled = true;
      el.keepAliveSetting.disabled = true;
      el.petAlwaysOnTopSetting.disabled = true;
      el.musicOnAlarmSetting.disabled = true;
      el.musicAppSelect.disabled = true;
      el.musicAppPathBtn.disabled = true;
      el.quitAppBtn.classList.add("is-hidden");
      return;
    }

    var settings = await window.api.getSettings();
    el.autoStartSetting.checked = !!settings.autoStartEnabled;
    el.keepAliveSetting.checked = !!settings.keepAliveEnabled;
    el.petAlwaysOnTopSetting.checked = !!settings.petAlwaysOnTop;
    if (settings.dataFile) {
      el.dataPathInfo.textContent = "数据文件：" + settings.dataFile;
    }
    if (el.versionInfo) {
      el.versionInfo.textContent = "版本：" + (settings.version || "未知") + " · 日志：" + (settings.logFile || "不可用");
    }
    if (el.openDataFolderBtn) {
      el.openDataFolderBtn.onclick = async function() {
        var result = await window.api.openDataFolder();
        if (result && !result.success) showNotification("目录打开失败");
      };
    }

    // ==================== 起床听歌 ====================
    var MUSIC_APP_LABELS = { netease: "网易云音乐", kugou: "酷狗音乐", qishui: "汽水音乐", custom: "自定义应用" };
    var musicPlatformSupported = true;
    function isQishuiMusicSetting(ms) {
      if (!ms) return false;
      if (ms.app === "qishui") return true;
      return ms.app === "custom" && /(?:soda|qishui|ssmusic|汽水)/i.test(ms.customPath || "");
    }
    function syncSceneModeControl(ms) {
      var select = document.getElementById("alarmMusicMode");
      var hint = document.getElementById("alarmMusicModeHint");
      var supported = isQishuiMusicSetting(ms);
      if (select) select.disabled = !supported;
      if (hint) {
        hint.textContent = supported
          ? "将尝试切换汽水音乐场景；汽水界面更新后可能需要重新校准"
          : "当前音乐应用不支持场景切换，仅会启动并尝试播放";
        hint.classList.toggle("is-warning", !supported);
      }
    }
    function renderMusicStatus(ms) {
      if (!ms) return;
      var label = MUSIC_APP_LABELS[ms.app] || "音乐应用";
      if (ms.app === "custom") {
        el.musicAppStatus.textContent = ms.customPath ? "路径：" + ms.customPath : "尚未选择应用";
      } else if (ms.foundPath) {
        el.musicAppStatus.textContent = label + " 已找到：" + ms.foundPath;
      } else {
        el.musicAppStatus.textContent = label + " 未找到，请选择" + label + "（或改用自定义应用）";
      }
    }
  function refreshMusicControls(ms) {
    if (typeof ms.platformSupported === "boolean") musicPlatformSupported = ms.platformSupported;
    var platformSupported = musicPlatformSupported;
    if (!platformSupported) {
      el.musicOnAlarmSetting.checked = false;
      el.musicOnAlarmSetting.disabled = true;
      el.musicAppSelect.disabled = true;
      el.musicAppPathBtn.disabled = true;
      el.musicAppStatus.textContent = "音乐应用自动启动与场景切换目前仅支持 Windows；Mac 版仍可使用闹钟歌曲。";
      return;
    }
      el.musicOnAlarmSetting.checked = !!ms.on;
      el.musicAppSelect.value = ms.app || "netease";
      el.musicAppSelect.disabled = !ms.on;
      el.musicAppPathBtn.disabled = !ms.on || (ms.app || "netease") !== "custom";
      renderMusicStatus(ms);
      syncSceneModeControl(ms);
    }
    var musicSettings = await window.api.getMusicSettings();
    refreshMusicControls(musicSettings);

    async function saveMusicSettings(next) {
      var res = await window.api.setMusicSettings(next);
      if (res) refreshMusicControls(res);
      showNotification("设置已保存");
    }

    el.musicOnAlarmSetting.onchange = function() {
      var on = el.musicOnAlarmSetting.checked;
      el.musicAppSelect.disabled = !on;
      el.musicAppPathBtn.disabled = !on || el.musicAppSelect.value !== "custom";
      saveMusicSettings({ on: on });
    };
    el.musicAppSelect.onchange = function() {
      var app = el.musicAppSelect.value;
      el.musicAppPathBtn.disabled = app !== "custom";
      saveMusicSettings({ app: app });
    };
    el.musicAppPathBtn.onclick = async function() {
      var picked = await window.api.pickMusicApp();
      if (picked && !picked.canceled && picked.path) {
        saveMusicSettings({ customPath: picked.path });
      }
    };
    if (el.testMusicAppBtn) {
      el.testMusicAppBtn.onclick = async function() {
        var modeSelect = document.getElementById("alarmMusicMode");
        var mode = modeSelect && !modeSelect.disabled ? (modeSelect.value || "起床") : "";
        el.testMusicAppBtn.disabled = true;
        el.testMusicAppBtn.textContent = "正在测试...";
        try {
          var res = await window.api.openMusicApp({ musicMode: mode, forcePlay: true });
          if (res && res.success && res.modeSelected) {
            showNotification("汽水音乐已进入" + mode + "场景");
          } else if (res && res.success && res.sceneSupported) {
            showNotification("汽水音乐已打开，但场景切换失败");
          } else if (res && res.success) {
            showNotification("音乐应用已启动；是否播放取决于应用当前状态");
          } else if (res && res.reason === "disabled") {
            showNotification("请先开启“铃声播完后自动打开音乐播放”");
          } else if (res && res.reason === "not-found") {
            showNotification("没有找到所选音乐应用");
          } else {
            showNotification("音乐应用测试失败");
          }
        } finally {
          el.testMusicAppBtn.disabled = false;
          el.testMusicAppBtn.textContent = "测试启动与播放";
        }
      };
    }

    async function saveSettings() {
      var next = {
        autoStartEnabled: el.autoStartSetting.checked,
        keepAliveEnabled: el.keepAliveSetting.checked,
        petAlwaysOnTop: el.petAlwaysOnTopSetting.checked
      };
      await window.api.setSettings(next);
      showNotification("设置已保存");
    }

    el.autoStartSetting.onchange = saveSettings;
    el.keepAliveSetting.onchange = saveSettings;
    el.petAlwaysOnTopSetting.onchange = saveSettings;
    el.quitAppBtn.onclick = function() {
      if (confirm("确定彻底退出智域计时吗？")) {
        window.api.quitApp();
      }
    };

    if (window.api.onSettingsUpdated) {
      window.api.onSettingsUpdated(function(nextSettings) {
        el.autoStartSetting.checked = !!nextSettings.autoStartEnabled;
        el.keepAliveSetting.checked = !!nextSettings.keepAliveEnabled;
        el.petAlwaysOnTopSetting.checked = !!nextSettings.petAlwaysOnTop;
        if (nextSettings && typeof nextSettings.musicOnAlarm !== "undefined") {
          refreshMusicControls({
            on: !!nextSettings.musicOnAlarm,
            app: nextSettings.musicApp || "netease",
            customPath: nextSettings.musicAppPath || ""
          });
        }
      });
    }
  }

  function setupMainProcessEvents() {
    if (!window.api) return;
    if (window.api.onPlayRingtone) {
      window.api.onPlayRingtone(function(payload) {
        if (payload && typeof payload === "object") {
          playRingtone(payload.src, { source: payload.source, musicMode: payload.musicMode, alarm: payload.alarm });
        } else {
          playRingtone(payload);
        }
      });
    }
    if (window.api.onAlarmTriggered) {
      window.api.onAlarmTriggered(function(alarm) {
        showNotification(alarm.label || alarm.time || "闹钟");
      });
    }
    if (window.api.onAlarmsUpdated) {
      window.api.onAlarmsUpdated(function(nextAlarms) {
        alarms = Array.isArray(nextAlarms) ? nextAlarms : [];
        renderAlarms();
      });
    }
    if (window.api.onAppWarning) {
      window.api.onAppWarning(function(warning) {
        showAppWarning(warning);
      });
    }
  }

  async function showStartupNotices() {
    if (!window.api || !window.api.getStartupNotices) return;
    try {
      var notices = await window.api.getStartupNotices();
      if (!Array.isArray(notices)) return;
      for (var i = 0; i < notices.length; i++) {
        if (notices[i] && notices[i].message) showAppWarning(notices[i]);
      }
    } catch (e) {}
  }

  // ==================== 收纳到宠物 ====================
  function setupMinimize() {
    document.getElementById("minimizeBtn").onclick = async function() {
      // 优先通过 IPC 通知主进程：隐藏主窗口 + 显示宠物窗口
      if (window.api && window.api.minimizeToPet) {
        try {
          await window.api.minimizeToPet();
          showNotification("已收纳到宠物模式");
        } catch (e) {
          showNotification("收纳失败: " + e.message);
        }
      } else {
        // fallback：纯浏览器 PWA 模式（Electron 中不会走到这里）
        showNotification("请直接打开 pet.html 启动宠物窗口");
      }
    };
  }

  // ==================== 主题切换 ====================
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var sw = document.getElementById("themeSwitch");
    if (sw) {
      sw.className = theme === "dark" ? "theme-switch active" : "theme-switch";
    }
  }

  function setupTheme() {
    var savedTheme = "light";
    try { savedTheme = localStorage.getItem("zhiyu-theme") || "light"; } catch (e) {}
    applyTheme(savedTheme);

    var toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.onclick = function() {
        var current = document.documentElement.getAttribute("data-theme") || "light";
        var next = current === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem("zhiyu-theme", next); } catch (e) {}
        // 同步到宠物窗口
        if (window.api && window.api.setTheme) {
          window.api.setTheme(next);
        }
      };
    }

    // 监听来自主进程的主题同步（宠物窗口触发 -> 主窗口）
    if (window.api && window.api.onThemeChanged) {
      window.api.onThemeChanged(function(theme) {
        applyTheme(theme);
        try { localStorage.setItem("zhiyu-theme", theme); } catch (e) {}
      });
    }
  }

  // ==================== 数据导入导出 ====================
  function setupDataIO() {
    var exportBtn = document.getElementById("exportDataBtn");
    var importBtn = document.getElementById("importDataBtn");

    if (exportBtn && window.api && window.api.exportData) {
      exportBtn.onclick = async function() {
        try {
          var result = await window.api.exportData();
          if (result.success) {
            showNotification("数据已导出");
          } else if (result.error) {
            showNotification("导出失败：" + result.error);
          }
        } catch (e) {
          showNotification("导出失败：" + e.message);
        }
      };
    }

    if (importBtn && window.api && window.api.importData) {
      importBtn.onclick = async function() {
        if (!confirm("导入数据将覆盖当前的闹钟、计次和设置，确定继续吗？")) return;
        try {
          var result = await window.api.importData();
          if (result.success) {
            // 重新加载页面数据
            await loadSavedData();
            renderAlarms();
            renderLaps();

            await restoreCountdownState();
            await restoreStopwatchState();

            showNotification("\u6570\u636e\u5df2\u5bfc\u5165");
          } else if (result.error) {
            showNotification("导入失败：" + result.error);
          }
        } catch (e) {
          showNotification("导入失败：" + e.message);
        }
      };
    }
  }

  // ==================== 设置弹窗开关 ====================
  function renderStopwatchElapsed(elapsed) {
    timerElapsed = elapsed || 0;
    var totalSeconds = Math.floor(timerElapsed / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var ms = timerElapsed % 1000;
    el.timerDisplay.textContent = pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
    el.timerMs.textContent = "." + ("00" + ms).slice(-3);
  }

  function applyStopwatchControls(state) {
    var startBtn = document.getElementById("startTimerBtn");
    var pauseBtn = document.getElementById("pauseTimerBtn");
    var lapBtn = document.getElementById("lapBtn");
    if (state === "running") {
      startBtn.textContent = "\u8fd0\u884c\u4e2d";
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      lapBtn.disabled = false;
      setTimerState("running");
    } else if (state === "paused") {
      startBtn.textContent = "\u7ee7\u7eed";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      lapBtn.disabled = false;
      setTimerState("paused");
    } else {
      startBtn.textContent = "\u5f00\u59cb";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      lapBtn.disabled = true;
      setTimerState("ready");
    }
  }

  async function restoreCountdownState() {
    try {
      if (!window.api || !window.api.getCountdown) return;
      var savedCountdown = await window.api.getCountdown();
      if (!savedCountdown || !savedCountdown.targetDate) return;
      if (LEGACY_COUNTDOWN_LABELS.indexOf(savedCountdown.label) !== -1) {
        clearCountdown(true);
        return;
      }
      var target = new Date(savedCountdown.targetDate);
      if (target > new Date()) {
        startCountdown(target, savedCountdown.label || "\u81ea\u5b9a\u4e49\u4e8b\u4ef6");
      } else {
        var label = savedCountdown.label || "\u5012\u8ba1\u65f6";
        playRingtone();
        showNotification(label + " \u5df2\u5230\u671f");
        notifySystem("\u5012\u8ba1\u65f6\u63d0\u9192", label + " \u5df2\u5230\u671f");
        if (window.api.setCountdown) window.api.setCountdown(null);
      }
    } catch (e) {}
  }

  async function restoreStopwatchState() {
    try {
      if (!window.api || !window.api.getStopwatch) return;
      var savedSw = await window.api.getStopwatch();
      if (!savedSw) return;
      clearInterval(timerInterval);
      if (savedSw.running && savedSw.startTime) {
        timerElapsed = Date.now() - savedSw.startTime;
        timerStartTime = savedSw.startTime;
        timerInterval = setInterval(updateTimer, 10);
        timerRunning = true;
        applyStopwatchControls("running");
        updateTimer();
        setPetActivity('work', 'stopwatch-restore');
      } else if (savedSw.elapsed > 0) {
        timerRunning = false;
        renderStopwatchElapsed(savedSw.elapsed);
        applyStopwatchControls("paused");
        syncPetWorkState('stopwatch-restore-paused');
      } else {
        timerRunning = false;
        applyStopwatchControls("ready");
        syncPetWorkState('stopwatch-restore-ready');
      }
    } catch (e) {}
  }

  function setupSettingsModal() {
    var overlay = document.getElementById("settingsOverlay");
    var openBtn = document.getElementById("settingsBtn");
    var closeBtn = document.getElementById("settingsCloseBtn");

    function openSettings() {
      overlay.className = "settings-overlay show";
    }
    function closeSettings() {
      overlay.className = "settings-overlay";
    }

    if (openBtn) openBtn.onclick = openSettings;
    if (closeBtn) closeBtn.onclick = closeSettings;

    // 点击遮罩关闭
    if (overlay) {
      overlay.onclick = function(e) {
        if (e.target === overlay) closeSettings();
      };
    }

    // ===== 设置选项卡切换 =====
    var stabBtns = document.querySelectorAll('#settingsTabs .settings-tab');
    stabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        stabBtns.forEach(function(b){ b.classList.remove('active'); });
        document.querySelectorAll('.settings-tabpage').forEach(function(p){ p.classList.remove('active'); });
        btn.classList.add('active');
        var pg = document.getElementById('stab-' + btn.dataset.stab);
        if (pg) pg.classList.add('active');
      });
    });

    // ===== 宠物走路参数：写 localStorage，宠物窗口监听 storage 实时生效 =====
    var PET_KEYS = { walkSpeed:'petWalkSpeed', walkAmp:'petWalkAmp', walkKnee:'petWalkKnee' };
    Object.keys(PET_KEYS).forEach(function(id){
      var el = document.getElementById(id);
      var key = PET_KEYS[id];
      var saved = localStorage.getItem(key);
      if (el && saved !== null) {
        el.value = saved;
        var out = document.getElementById(id+'Val');
        if (out) out.textContent = saved;
      }
      if (el) el.addEventListener('input', function(){
        var o = document.getElementById(id+'Val');
        if (o) o.textContent = el.value;
        localStorage.setItem(key, el.value);
      });
    });
    var petAutoChk = document.getElementById('petAutoMotionSetting');
    if (petAutoChk) {
      petAutoChk.checked = localStorage.getItem('petAutoMotion') !== 'false';
      petAutoChk.addEventListener('change', function(){
        localStorage.setItem('petAutoMotion', petAutoChk.checked ? 'true' : 'false');
      });
    }
    var petMotionMode = document.getElementById('petMotionModeSetting');
    if (petMotionMode) {
      var savedMotionMode = localStorage.getItem('petMotionMode');
      petMotionMode.value = /^(mixed|roam|march)$/.test(savedMotionMode || '') ? savedMotionMode : 'mixed';
      petMotionMode.addEventListener('change', function(){
        localStorage.setItem('petMotionMode', petMotionMode.value);
      });
    }
    var petPrevBtn = document.getElementById('walkPreviewBtn');
    if (petPrevBtn) {
      petPrevBtn.addEventListener('click', function(){
        localStorage.setItem('petWalkPreview', String(Date.now()));
      });
    }
  }

  // ==================== 初始化 ====================
  async function init() {
    await loadSavedData();

    if (window.api && window.api.getFocusSessions) {
      focusSessions = await window.api.getFocusSessions() || [];
    }
    renderFocusSummary();

    await restoreCountdownState();
    await restoreStopwatchState();

    updateDateTime();
    setInterval(updateDateTime, 1000);
    setInterval(checkAlarms, 1000);
    setupWarningPanel();
    setupMainProcessEvents();
    setupTabs();
    setupCountdown();
    setupTimer();
    setupAlarm();
    setupAlarmVerification();
    setupRingtone();
    loadRingtoneLibrary();
    await setupSettings();
    setupMinimize();
    setupTheme();
    setupDataIO();
    setupSettingsModal();
    renderAlarms();
    renderLaps();  // 渲染保存的计次
    await showStartupNotices();
    window._initComplete = Date.now();
    console.log("桌面计时器初始化完成 ✓");

  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function() {
      init().catch(function(e) { showError("初始化失败: " + e.message); });
    });
  } else {
    init().catch(function(e) { showError("初始化失败: " + e.message); });
  }

} catch (e) {
  showError("初始化失败: " + e.message);
}
