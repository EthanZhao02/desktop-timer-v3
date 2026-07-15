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
  var timerInterval = null;
  var timerStartTime = 0;
  var timerElapsed = 0;
  var timerRunning = false;
  var lapCount = 0;
  var laps = [];  // 计次数据
  var alarms = [];
  var currentAudio = null;  // 当前播放的音频
  var customRingtoneData = null;
  var customRingtoneName = "";
  var defaultRingtoneSrc = null;

  // ==================== DOM 元素 ====================
  var el = {
    currentDate: document.getElementById("currentDate"),
    currentTime: document.getElementById("currentTime"),
    countdownDisplay: document.getElementById("countdownDisplay"),
    countdownLabel: document.getElementById("countdownLabel"),
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
    clearLapsBtn: document.getElementById("clearLapsBtn"),
    autoStartSetting: document.getElementById("autoStartSetting"),
    keepAliveSetting: document.getElementById("keepAliveSetting"),
    quitAppBtn: document.getElementById("quitAppBtn"),
    dataPathInfo: document.getElementById("dataPathInfo")
  };

  // ==================== 工具函数 ====================
  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
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
  function startCountdown(targetDate, label) {
    if (countdownInterval) clearInterval(countdownInterval);
    el.countdownLabel.textContent = "距离 " + label + " 还有";
    el.countdownLabel.className = "countdown-label pulse";
    el.countdownDisplay.className = "countdown-value pulse";

    // 持久化倒计时状态
    if (window.api && window.api.setCountdown) {
      window.api.setCountdown({ targetDate: targetDate.toISOString(), label: label });
    }

    countdownInterval = setInterval(function() {
      var now = new Date();
      var diff = targetDate.getTime() - now.getTime();

      if (diff <= 0) {
        clearInterval(countdownInterval);
        el.countdownDisplay.textContent = "时间到！";
        el.countdownLabel.textContent = label;
        el.countdownLabel.className = "countdown-label";
        el.countdownDisplay.className = "countdown-value";
        playRingtone();
        showNotification(label + " 到了！");
        notifySystem("倒计时提醒", label + " 到了！");
        // 清除已过期倒计时
        if (window.api && window.api.setCountdown) {
          window.api.setCountdown(null);
        }
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
    }, 1000);
  }

  function getNextLunarNewYear(now) {
    var dates = {
      2026: [1, 17],
      2027: [1, 6],
      2028: [0, 26],
      2029: [1, 13],
      2030: [1, 3],
      2031: [0, 23],
      2032: [1, 11],
      2033: [0, 31],
      2034: [1, 19],
      2035: [1, 8],
      2036: [0, 28]
    };
    for (var y = now.getFullYear(); y <= 2036; y++) {
      if (!dates[y]) continue;
      var target = new Date(y, dates[y][0], dates[y][1], 0, 0, 0);
      if (target > now) return target;
    }
    return null;
  }

  function setupPresets() {
    var presets = document.querySelectorAll(".preset-btn");
    for (var i = 0; i < presets.length; i++) {
      presets[i].onclick = (function(btn) {
        return function() {
          var type = btn.getAttribute("data-preset");
          var now = new Date();
          var year = now.getFullYear();
          var target, label;

          if (type === "kaoyan") {
            target = new Date(year, 11, 21, 0, 0, 0);
            if (target < now) target = new Date(year + 1, 11, 21, 0, 0, 0);
            label = "考研";
          } else if (type === "kaogong") {
            target = new Date(year, 0, 15, 0, 0, 0);
            if (target < now) target = new Date(year + 1, 0, 15, 0, 0, 0);
            label = "考公";
          } else if (type === "guonian") {
            target = getNextLunarNewYear(now);
            if (!target) {
              showNotification("请用自定义日期设置春节倒计时");
              return;
            }
            label = "过年";
          } else if (type === "shangban") {
            target = new Date(year, now.getMonth(), now.getDate(), 9, 0, 0);
            if (target < now) target.setDate(target.getDate() + 1);
            label = "上班";
          }

          if (target) startCountdown(target, label);
        };
      })(presets[i]);
    }

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
      return;
    }
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
      }
    };

    resetBtn.onclick = function() {
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
      label.textContent = (a.label || "") + (a.repeat ? " · 每天" : "");

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

      var deleteButton = document.createElement("button");
      deleteButton.className = "delete-alarm";
      deleteButton.type = "button";
      deleteButton.title = "删除闹钟";
      deleteButton.textContent = "✕";
      deleteButton.onclick = (function(id) {
        return function() { deleteAlarm(id); };
      })(Number(a.id));

      info.append(time, label);
      actions.append(toggle, deleteButton);
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

  function setupAlarm() {
    document.getElementById("addAlarmBtn").onclick = function() {
      var timeInput = document.getElementById("alarmTime").value;
      var labelInput = document.getElementById("alarmLabel").value;
      var repeat = document.getElementById("repeatDaily").checked;

      if (!timeInput) {
        showNotification("请选择闹钟时间");
        return;
      }

      var alarm = {
        id: Date.now(),
        time: timeInput,
        label: labelInput || "闹钟",
        repeat: repeat,
        enabled: true,
        triggered: false
      };

      alarms.push(alarm);
      saveAlarms();
      renderAlarms();

      document.getElementById("alarmTime").value = "";
      document.getElementById("alarmLabel").value = "";
      document.getElementById("repeatDaily").checked = false;

      showNotification("闹钟已添加：" + alarm.time);
    };
  }

  function checkAlarms() {
    if (window.api && window.api.getAlarms) return;
    var now = new Date();
    var currentTime = pad(now.getHours()) + ":" + pad(now.getMinutes());
    for (var i = 0; i < alarms.length; i++) {
      var alarm = alarms[i];
      if (alarm.enabled && alarm.time === currentTime && !alarm.triggered) {
        alarm.triggered = true;
        playRingtone();
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
    el.audioControl.className = "audio-control";
    if (window._audioTimeout) {
      clearTimeout(window._audioTimeout);
      window._audioTimeout = null;
    }
  }

  function playRingtone(src) {
    // 停止之前的声音
    stopCurrentAudio();

    var mode = getPlayMode();
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
          setTimeout(function() {
            el.audioControl.className = "audio-control";
          }, 2000);
        };

        currentAudio.onerror = function() {
          el.audioStatus.textContent = "✗ 播放错误，使用默认提示音";
          playDefaultSound(mode);
        };

        currentAudio.play().catch(function(err) {
          el.audioStatus.textContent = "播放失败";
          console.error("[Audio] play() failed:", err.message, err.name);
          playDefaultSound(mode);
        });

        // 根据模式设置停止时间
        if (mode === "30s") {
          window._audioTimeout = setTimeout(stopCurrentAudio, 30000);
        } else if (mode === "60s") {
          window._audioTimeout = setTimeout(stopCurrentAudio, 60000);
        }
        // "full" 播放完整音频，"manual" 循环直到手动停止

      } catch (e) {
        playDefaultSound(mode);
      }
    } else {
      playDefaultSound(mode);
    }
  }

  function playDefaultSound(mode) {
    try {
      console.log("[Audio] playDefaultSound called, mode=" + mode);
      var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
          playDefaultSound(mode);
        }, 2200);
        if (mode === "30s") setTimeout(stopCurrentAudio, 30000);
        if (mode === "60s") setTimeout(stopCurrentAudio, 60000);
      } else {
        setTimeout(function() {
          el.audioControl.className = "audio-control";
        }, 2500);
      }
    } catch (e) {}
  }

  function setupRingtone() {
    document.getElementById("selectRingtoneBtn").onclick = function() {
      document.getElementById("ringtoneFile").click();
    };

    document.getElementById("ringtoneFile").onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      if (!/\.(wav|mp3)$/i.test(file.name)) {
        showNotification("请选择 WAV 或 MP3 铃声文件");
        e.target.value = "";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showNotification("铃声文件太大，请选择不超过 5MB 的文件");
        e.target.value = "";
        return;
      }
      var reader = new FileReader();
      reader.onload = async function(event) {
        try {
          customRingtoneData = event.target.result;
          customRingtoneName = file.name;
          if (window.api && window.api.setRingtone) {
            await window.api.setRingtone({ src: customRingtoneData, name: customRingtoneName });
          }
          el.ringtoneName.textContent = "已选择: " + file.name;
          showNotification("铃声已更换，播放闹钟时会使用");
        } catch (err) {
          showNotification("铃声文件太大，请选择小于5MB的文件");
        }
      };
      reader.readAsDataURL(file);
    };

    // 显示已选择的铃声
    if (customRingtoneData && customRingtoneName) {
      el.ringtoneName.textContent = "已选择: " + customRingtoneName;
    }

    // 停止按钮
    document.getElementById("stopAudioBtn").onclick = stopCurrentAudio;
  }

  async function setupSettings() {
    if (!window.api || !window.api.getSettings) {
      el.autoStartSetting.disabled = true;
      el.keepAliveSetting.disabled = true;
      el.quitAppBtn.classList.add("is-hidden");
      return;
    }

    var settings = await window.api.getSettings();
    el.autoStartSetting.checked = !!settings.autoStartEnabled;
    el.keepAliveSetting.checked = !!settings.keepAliveEnabled;
    if (settings.dataFile) {
      el.dataPathInfo.textContent = "数据文件：" + settings.dataFile;
    }

    async function saveSettings() {
      var next = {
        autoStartEnabled: el.autoStartSetting.checked,
        keepAliveEnabled: el.keepAliveSetting.checked
      };
      await window.api.setSettings(next);
      showNotification("设置已保存");
    }

    el.autoStartSetting.onchange = saveSettings;
    el.keepAliveSetting.onchange = saveSettings;
    el.quitAppBtn.onclick = function() {
      if (confirm("确定彻底退出智域计时吗？")) {
        window.api.quitApp();
      }
    };

    if (window.api.onSettingsUpdated) {
      window.api.onSettingsUpdated(function(nextSettings) {
        el.autoStartSetting.checked = !!nextSettings.autoStartEnabled;
        el.keepAliveSetting.checked = !!nextSettings.keepAliveEnabled;
      });
    }
  }

  function setupMainProcessEvents() {
    if (!window.api) return;
    if (window.api.onPlayRingtone) {
      window.api.onPlayRingtone(function(src) {
        playRingtone(src);
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
      } else if (savedSw.elapsed > 0) {
        timerRunning = false;
        renderStopwatchElapsed(savedSw.elapsed);
        applyStopwatchControls("paused");
      } else {
        timerRunning = false;
        applyStopwatchControls("ready");
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

    // ESC 关闭
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && overlay && overlay.className.indexOf("show") !== -1) {
        closeSettings();
      }
    });
  }

  // ==================== 初始化 ====================
  async function init() {
    await loadSavedData();

    await restoreCountdownState();
    await restoreStopwatchState();

    updateDateTime();
    setInterval(updateDateTime, 1000);
    setInterval(checkAlarms, 1000);
    setupWarningPanel();
    setupMainProcessEvents();
    setupTabs();
    setupPresets();
    setupTimer();
    setupAlarm();
    setupRingtone();
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
