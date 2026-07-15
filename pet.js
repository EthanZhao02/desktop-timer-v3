// 错误捕获
window.onerror = function(msg, url, line) {
  console.error("Pet Error:", msg, "Line:", line);
  return false;
};

try {
  var petContainer = document.getElementById("petContainer");
  var petImage = document.getElementById("petImage");
  var petTime = document.getElementById("petTime");
  var petBubble = document.getElementById("petBubble");
  var petStatus = document.getElementById("petStatus");
  var petClose = document.getElementById("petClose");
  var miniInfo = document.getElementById("miniInfo");
  var nextAlarmTime = document.getElementById("nextAlarmTime");
  var dragHint = document.querySelector(".drag-hint");

  // ==================== 透明窗口点击穿透 ====================
  var petMouseEventsEnabled = null;
  var petControlsVisible = false;
  var dragPointerId = null;
  var dragStartScreenX = 0;
  var dragStartScreenY = 0;
  var dragWindowX = 0;
  var dragWindowY = 0;
  var imgDragMoved = false;

  function pointHitsElement(x, y, element, padding) {
    if (!element) return false;
    var style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    var rect = element.getBoundingClientRect();
    var pad = padding || 0;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return x >= rect.left - pad &&
      x <= rect.right + pad &&
      y >= rect.top - pad &&
      y <= rect.bottom + pad;
  }

  function setPetControlsVisible(visible) {
    var next = visible === true;
    if (petControlsVisible === next) return;
    petControlsVisible = next;
    petContainer.classList.toggle("controls-visible", next);
  }

  function shouldShowPetControls(x, y) {
    if (dragPointerId !== null) return false;
    return pointHitsElement(x, y, petImage) ||
      pointHitsElement(x, y, petTime) ||
      (petControlsVisible && pointHitsElement(x, y, petClose)) ||
      pointHitsElement(x, y, miniInfo) ||
      pointHitsElement(x, y, petBubble);
  }

  function setPetMouseEvents(enabled) {
    var next = enabled === true;
    if (petMouseEventsEnabled === next) return;
    petMouseEventsEnabled = next;
    if (window.api && window.api.setPetMouseEvents) {
      window.api.setPetMouseEvents(next);
    }
  }

  function updatePetMouseEvents(e) {
    if (!e) {
      setPetControlsVisible(false);
      setPetMouseEvents(false);
      return;
    }
    var controlsVisible = shouldShowPetControls(e.clientX, e.clientY);
    setPetControlsVisible(controlsVisible);
    setPetMouseEvents(controlsVisible || pointHitsElement(e.clientX, e.clientY, dragHint));
  }

  document.addEventListener("mousemove", updatePetMouseEvents);
  document.addEventListener("mouseleave", function() {
    if (dragPointerId === null) {
      setPetControlsVisible(false);
      setPetMouseEvents(false);
    }
  });

  // ==================== 时间显示 ====================
  function updateTime() {
    var now = new Date();
    var h = now.getHours() < 10 ? "0" + now.getHours() : "" + now.getHours();
    var m = now.getMinutes() < 10 ? "0" + now.getMinutes() : "" + now.getMinutes();
    var s = now.getSeconds() < 10 ? "0" + now.getSeconds() : "" + now.getSeconds();
    petTime.textContent = h + ":" + m + ":" + s;
  }

  // ==================== 检查闹钟 ====================
  async function checkAlarms() {
    try {
      var alarms = [];
      if (window.api && window.api.getAlarms) {
        alarms = await window.api.getAlarms();
      } else {
        var saved = localStorage.getItem("desktopTimerAlarms");
        if (!saved) return;
        alarms = JSON.parse(saved);
      }
      if (!alarms || alarms.length === 0) {
        petStatus.className = "pet-status";
        nextAlarmTime.textContent = "--:--";
        return;
      }

      // 找到下一个最近的闹钟
      var now = new Date();
      var currentMinutes = now.getHours() * 60 + now.getMinutes();
      var nearest = null;
      var nearestDiff = 99999;

      for (var i = 0; i < alarms.length; i++) {
        var alarm = alarms[i];
        if (!alarm.enabled) continue;
        var parts = alarm.time.split(":");
        var alarmMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        var diff = alarmMinutes - currentMinutes;
        if (diff < 0) diff += 24 * 60; // 跨天
        if (diff < nearestDiff) {
          nearestDiff = diff;
          nearest = alarm;
        }
      }

      if (nearest) {
        var h = Math.floor(nearestDiff / 60);
        var m = nearestDiff % 60;
        nextAlarmTime.textContent = nearest.time + " (" + (h > 0 ? h + "小时" : "") + m + "分后)";
        petStatus.className = "pet-status alarm-active";
      } else {
        petStatus.className = "pet-status";
        nextAlarmTime.textContent = "--:--";
      }
    } catch (e) {}
  }

  // ==================== 鼠标悬停提示 ====================
  var bubbleTimer = null;
  petImage.onmouseenter = function() {
    if (dragPointerId !== null) return;
    clearTimeout(bubbleTimer);
    miniInfo.className = "mini-info show";
  };
  petImage.onmouseleave = function() {
    bubbleTimer = setTimeout(function() {
      miniInfo.className = "mini-info";
    }, 300);
  };

  // ==================== 点击展开计时器 ====================
  petImage.onclick = async function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (imgDragMoved) return;

    // 涟漪效果
    petImage.classList.add('ripple');
    setTimeout(function() { petImage.classList.remove('ripple'); }, 600);

    // 尝试打开主窗口
    try {
      // 优先通过 IPC 通知主进程显示已有主窗口（避免重复开窗）
      if (window.api && window.api.showMain) {
        await window.api.showMain();
        return;
      }

      // 兜底（纯浏览器 PWA 模式）：只聚焦现有窗口，绝不用 window.open 开新窗
      var mainWin = window.opener;
      if (mainWin && !mainWin.closed) {
        mainWin.focus();
        return;
      }
      showMessage("请手动打开主计时器窗口");
    } catch (err) {
      console.error("打开主窗口失败:", err);
    }
  };

  // ==================== 关闭按钮 ====================
  petClose.onclick = function(e) {
    e.stopPropagation();
    if (window.api && window.api.hidePet) {
      window.api.hidePet();
    } else {
      window.close();
    }
  };

  // ==================== 拖动功能 ====================
  function isDragHandle(target) {
    return target === petImage ||
      petImage.contains(target) ||
      target === petTime ||
      petTime.contains(target) ||
      target === miniInfo ||
      miniInfo.contains(target) ||
      target === petBubble ||
      petBubble.contains(target) ||
      target === dragHint;
  }

  function canStartDrag(e) {
    if (e.target === petClose || petClose.contains(e.target)) return false;
    return isDragHandle(e.target) ||
      pointHitsElement(e.clientX, e.clientY, petImage) ||
      pointHitsElement(e.clientX, e.clientY, petTime);
  }

  petContainer.onpointerdown = function(e) {
    if (e.button !== 0 || !canStartDrag(e)) return;
    dragPointerId = e.pointerId;
    dragStartScreenX = e.screenX;
    dragStartScreenY = e.screenY;
    dragWindowX = window.screenX;
    dragWindowY = window.screenY;
    imgDragMoved = false;
    setPetMouseEvents(true);
    setPetControlsVisible(false);
    petContainer.setPointerCapture(e.pointerId);
    petContainer.classList.add("dragging");
    petContainer.style.cursor = "grabbing";
    miniInfo.className = "mini-info";
  };

  petContainer.onpointermove = function(e) {
    if (e.pointerId !== dragPointerId) return;
    var dx = e.screenX - dragStartScreenX;
    var dy = e.screenY - dragStartScreenY;
    if (Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    imgDragMoved = true;
    if (window.api && window.api.movePetTo) {
      window.api.movePetTo(dragWindowX + dx, dragWindowY + dy);
    }
  };

  function finishDrag(e) {
    if (dragPointerId === null || (e && e.pointerId !== dragPointerId)) return;
    if (imgDragMoved) {
      // 第一次拖动后隐藏提示
      var hint = document.querySelector(".drag-hint");
      if (hint) hint.style.display = "none";
    }
    if (petContainer.hasPointerCapture(dragPointerId)) {
      petContainer.releasePointerCapture(dragPointerId);
    }
    dragPointerId = null;
    petContainer.classList.remove("dragging");
    petContainer.style.cursor = "default";
    setTimeout(function() {
      imgDragMoved = false;
      updatePetMouseEvents(e);
    }, 0);
  }

  petContainer.onpointerup = finishDrag;
  petContainer.onpointercancel = finishDrag;
  window.addEventListener("blur", function() { finishDrag(); });

  // ==================== 临时消息 ====================
  function showMessage(msg) {
    petBubble.textContent = msg;
    petBubble.className = "pet-bubble show";
    setTimeout(function() {
      petBubble.className = "pet-bubble";
    }, 3000);
  }

  // ==================== 初始化 ====================
  function init() {
    updateTime();
    setInterval(updateTime, 1000);
    checkAlarms();
    setInterval(checkAlarms, 30000);
    if (window.api && window.api.onAlarmsUpdated) {
      window.api.onAlarmsUpdated(function() { checkAlarms(); });
    }

    // 闹钟触发时宠物反应动画
    if (window.api && window.api.onAlarmTriggered) {
      window.api.onAlarmTriggered(function(alarm) {
        triggerAlarmReaction(alarm);
      });
    }

    // 主题同步
    if (window.api && window.api.onThemeChanged) {
      window.api.onThemeChanged(function(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem("zhiyu-theme", theme); } catch (e) {}
      });
    }
    // 读取保存的主题
    try {
      var savedTheme = localStorage.getItem("zhiyu-theme");
      if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
    } catch (e) {}

    // 5秒后显示欢迎气泡
    setTimeout(function() {
      petBubble.textContent = "点击我打开计时器！";
      petBubble.className = "pet-bubble show";
      setTimeout(function() {
        petBubble.className = "pet-bubble";
      }, 4000);
    }, 1500);

    console.log("桌面宠物启动成功 ✓");
    setPetMouseEvents(false);
  }

  // ==================== 闹钟反应动画 ====================
  var alarmExclaim = document.getElementById("alarmExclaim");

  function triggerAlarmReaction(alarm) {
    var label = (alarm && alarm.label) ? alarm.label : "闹钟";
    console.log("[Pet] Alarm reaction triggered: " + label);
    // 全屏闪光
    document.body.className = "alarm-flash";
    setTimeout(function() { document.body.className = ""; }, 2500);

    // 摇头（已包含红色脉冲光环）
    petImage.classList.add("alarm-shake");
    // 头顶感叹号弹出
    alarmExclaim.className = "alarm-exclaim show";
    // 红色气泡
    petBubble.textContent = label + " 响啦！";
    petBubble.className = "pet-bubble alarm-bubble show";
    // 状态灯闪烁
        petStatus.className = "pet-status scheduled";

    // 2秒后恢复动画class
    setTimeout(function() {
      petImage.classList.remove("alarm-shake");
    }, 2000);
    // 2.5秒后感叹号消失
    setTimeout(function() {
      alarmExclaim.className = "alarm-exclaim";
    }, 2500);
    // 5秒后恢复气泡
    setTimeout(function() {
      petBubble.className = "pet-bubble";
    }, 5000);
    // 7秒后恢复状态灯
    setTimeout(function() {
      checkAlarms();
    }, 7000);
  }

  // ==================== 三连击测试动画 ====================
  petImage.addEventListener("dblclick", function(e) {
    e.preventDefault();
    e.stopPropagation();
    console.log("[Pet] Double-click: testing alarm animation");
    triggerAlarmReaction({ label: "测试" });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

} catch (e) {
  var errorBox = document.createElement("div");
  errorBox.className = "pet-error";
  errorBox.textContent = "宠物启动失败: " + e.message;
  document.body.replaceChildren(errorBox);
}
