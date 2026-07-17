// 错误捕获
window.onerror = function(msg, url, line) {
  console.error("Pet Error:", msg, "Line:", line);
  return false;
};

try {
  var petImage = document.getElementById("petImage");
  var petImg = document.getElementById("petImg");
  var petTime = document.getElementById("petTime");
  var petBubble = document.getElementById("petBubble");
  var petStatus = document.getElementById("petStatus");
  var petClose = document.getElementById("petClose");
  var miniInfo = document.getElementById("miniInfo");
  var nextAlarmTime = document.getElementById("nextAlarmTime");

  // 对话面板
  var chatPanel = document.getElementById("petChatPanel");
  var chatMessages = document.getElementById("petChatMessages");
  var chatInput = document.getElementById("petChatInput");
  var chatSendBtn = document.getElementById("petChatSend");
  var chatCloseBtn = document.getElementById("petChatClose");

  // ==================== 多姿态系统 ====================
  var POSES = {
    idle:        "assets/pet-idle.png",
    laptop:      "assets/pet-laptop.png",
    reading:     "assets/pet-reading.png",
    coffee:      "assets/pet-coffee.png",
    sleeping:    "assets/pet-sleeping.png",
    thinking:    "assets/pet-thinking.png",
    celebrating: "assets/pet-celebrating.png",
    walking:     "assets/pet-walking.png",
    phone:       "assets/pet-phone.png",
    writing:     "assets/pet-writing.png",
    music:       "assets/pet-music.png",
    peeking:     "assets/pet-peeking.png"
  };

  // 姿态分类
  var idlePoses = ["idle", "reading", "coffee", "thinking", "phone", "music"];
  var workPoses = ["laptop", "writing"];
  var specialPoses = ["walking", "peeking"];

  // 姿态对应气泡文字
  var poseBubbles = {
    idle:        "",
    laptop:      "认真工作中...",
    reading:     "充充电~",
    coffee:      "来杯咖啡",
    sleeping:    "Zzz...",
    thinking:    "在想什么呢...",
    celebrating: "",
    walking:     "出去走走~",
    phone:       "刷一会儿",
    writing:     "记笔记中...",
    music:       "♪ 听歌放松 ♪",
    peeking:     "偷偷看你~"
  };

  var currentPose = "idle";
  var isAlarmActive = false;
  var poseTimer = null;
  var bubblePoseTimer = null;

  // 预加载所有图片（确保切换无延迟）
  var preloadedImages = {};
  Object.keys(POSES).forEach(function(key) {
    var img = new Image();
    img.src = POSES[key];
    preloadedImages[key] = img;
  });

  // 切换姿态（带淡入淡出过渡）
  function switchPose(poseName) {
    if (isAlarmActive && poseName !== "celebrating") return;
    if (!POSES[poseName]) return;
    if (poseName === currentPose && !isAlarmActive) return;

    currentPose = poseName;
    // 淡出
    petImg.style.opacity = "0";

    setTimeout(function() {
      petImg.src = POSES[poseName];
      // 淡入
      petImg.style.opacity = "1";

      // 显示姿态气泡
      clearTimeout(bubblePoseTimer);
      var bubble = poseBubbles[poseName];
      if (bubble && !isAlarmActive) {
        petBubble.textContent = bubble;
        petBubble.className = "pet-bubble show";
        bubblePoseTimer = setTimeout(function() {
          if (!isAlarmActive) petBubble.className = "pet-bubble";
        }, 3500);
      }
    }, 280);

    console.log("[Pet] Pose -> " + poseName);
  }

  // 随机选取一个姿态（排除当前）
  function randomPick(arr) {
    var filtered = arr.filter(function(p) { return p !== currentPose; });
    if (filtered.length === 0) filtered = arr;
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  // 自动姿态切换（基于时间 + 随机）
  function autoSwitchPose() {
    if (isAlarmActive) return;

    var now = new Date();
    var hour = now.getHours();
    var day = now.getDay(); // 0=Sunday

    // 深夜 (0:00-6:00): 睡觉
    if (hour >= 0 && hour < 6) {
      switchPose("sleeping");
      schedulePoseTimer(40000 + Math.random() * 20000);
      return;
    }

    // 清晨 (6:00-8:00): 咖啡或走路
    if (hour >= 6 && hour < 8) {
      var morningPoses = ["coffee", "walking", "idle", "phone"];
      switchPose(randomPick(morningPoses));
      schedulePoseTimer(25000 + Math.random() * 15000);
      return;
    }

    // 工作时间 (8:00-18:00 工作日): 混合工作和休闲
    if (hour >= 8 && hour < 18 && day >= 1 && day <= 5) {
      var r = Math.random();
      if (r < 0.35) {
        // 35% 工作姿态
        switchPose(randomPick(workPoses));
      } else if (r < 0.45) {
        // 10% 特殊姿态（彩蛋）
        switchPose(randomPick(specialPoses));
      } else {
        // 55% 休闲待机
        switchPose(randomPick(idlePoses));
      }
      schedulePoseTimer(20000 + Math.random() * 20000);
      return;
    }

    // 晚间/周末: 以休闲为主，偶尔特殊
    var eveningR = Math.random();
    if (eveningR < 0.12) {
      switchPose(randomPick(specialPoses));
    } else if (eveningR < 0.25) {
      switchPose("music");
    } else {
      switchPose(randomPick(idlePoses));
    }
    schedulePoseTimer(22000 + Math.random() * 18000);
  }

  function schedulePoseTimer(ms) {
    clearTimeout(poseTimer);
    poseTimer = setTimeout(autoSwitchPose, ms);
  }

  // ==================== 实时状态检测 ====================
  var windowStateActive = false; // 标记是否正在使用实时检测
  var windowStateTimer = null;

  // 进程名 → 姿态映射
  var processPoseMap = {
    // 聊天应用
    "wechat": { pose: "phone", bubble: "在微信聊天..." },
    "weixin": { pose: "phone", bubble: "在微信聊天..." },
    "qq": { pose: "phone", bubble: "QQ聊天中..." },
    "telegram": { pose: "phone", bubble: "Telegram聊天..." },
    "dingtalk": { pose: "phone", bubble: "钉钉沟通中..." },
    "lark": { pose: "phone", bubble: "飞书沟通中..." },
    "discord": { pose: "phone", bubble: "Discord聊天..." },
    // 浏览器
    "chrome": { pose: "reading", bubble: "浏览网页中..." },
    "firefox": { pose: "reading", bubble: "浏览网页中..." },
    "msedge": { pose: "reading", bubble: "浏览网页中..." },
    "opera": { pose: "reading", bubble: "浏览网页中..." },
    "brave": { pose: "reading", bubble: "浏览网页中..." },
    // 视频/音乐
    "potplayer": { pose: "music", bubble: "♪ 看视频中 ♪" },
    "vlc": { pose: "music", bubble: "♪ 看视频中 ♪" },
    "spotify": { pose: "music", bubble: "♪ 听歌中 ♪" },
    "cloudmusic": { pose: "music", bubble: "♪ 网易云音乐 ♪" },
    "kuwo": { pose: "music", bubble: "♪ 听音乐中 ♪" },
    "kugou": { pose: "music", bubble: "♪ 听音乐中 ♪" },
    "bilibili": { pose: "reading", bubble: "刷B站中..." },
    // 办公/编辑器
    "code": { pose: "laptop", bubble: "VSCode 编程中..." },
    "cursor": { pose: "laptop", bubble: "Cursor 编程中..." },
    "webstorm": { pose: "laptop", bubble: "编程中..." },
    "intellij": { pose: "laptop", bubble: "编程中..." },
    "pycharm": { pose: "laptop", bubble: "Python编程中..." },
    "winword": { pose: "writing", bubble: "Word 写文档..." },
    "excel": { pose: "writing", bubble: "Excel 做表..." },
    "powerpnt": { pose: "writing", bubble: "PPT 制作中..." },
    "notepad": { pose: "writing", bubble: "记笔记中..." },
    "onenote": { pose: "writing", bubble: "OneNote笔记..." },
    // 设计
    "photoshop": { pose: "thinking", bubble: "PS 设计中..." },
    "figma": { pose: "thinking", bubble: "Figma 设计中..." },
    "illustrator": { pose: "thinking", bubble: "AI 设计中..." },
    // 锁屏
    "lockscreen": { pose: "sleeping", bubble: "Zzz..." },
    "lockapp": { pose: "sleeping", bubble: "Zzz..." }
  };

  function handleWindowState(state) {
    if (isAlarmActive) return;

    windowStateActive = true;
    clearTimeout(poseTimer);

    var proc = (state.process || '').toLowerCase().replace(/\.exe$/i, '');
    var idleMs = state.idleMs || 0;
    var locked = state.locked || false;

    // 锁屏 → 睡觉
    if (locked || proc === 'lockscreen' || proc === 'lockapp') {
      switchPoseWithBubble("sleeping", "Zzz... (锁屏中)");
      return;
    }

    // 空闲超过5分钟 → 睡觉
    if (idleMs > 300000) {
      switchPoseWithBubble("sleeping", "Zzz... (发呆中)");
      return;
    }

    // 空闲超过2分钟 → 思考
    if (idleMs > 120000) {
      switchPoseWithBubble("thinking", "发呆中...");
      return;
    }

    // 根据进程名匹配姿态
    var matched = null;
    var keys = Object.keys(processPoseMap);
    for (var i = 0; i < keys.length; i++) {
      if (proc.indexOf(keys[i]) !== -1) {
        matched = processPoseMap[keys[i]];
        break;
      }
    }

    if (matched) {
      switchPoseWithBubble(matched.pose, matched.bubble);
    } else {
      // 未知程序：随机休闲（不频繁切换）
      if (currentPose !== "idle" && currentPose !== "reading" && currentPose !== "coffee") {
        switchPose(randomPick(idlePoses));
      }
    }

    // 设置超时：如果15秒没有新状态，恢复自动切换
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(function() {
      windowStateActive = false;
      autoSwitchPose();
    }, 15000);
  }

  // 带气泡的姿态切换
  function switchPoseWithBubble(poseName, bubble) {
    if (poseName === currentPose) return;
    switchPose(poseName);
    if (bubble && !isAlarmActive) {
      clearTimeout(bubblePoseTimer);
      setTimeout(function() {
        petBubble.textContent = bubble;
        petBubble.className = "pet-bubble show";
        bubblePoseTimer = setTimeout(function() {
          if (!isAlarmActive) petBubble.className = "pet-bubble";
        }, 4000);
      }, 300);
    }
  }

  // ==================== JS拖动（无webkit-app-region: drag干扰点击和动画）====================
  petImage.style['-webkit-app-region'] = 'no-drag';
  petImage.style.cursor = 'grab';

  var dragging = false;
  var dragStartX = 0, dragStartY = 0;
  var winStartX = 0, winStartY = 0;
  var hasDragged = false;

  petImage.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    dragging = true;
    hasDragged = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    winStartX = window.screenX;
    winStartY = window.screenY;
    petImage.setPointerCapture(e.pointerId);
    petImage.style.cursor = 'grabbing';
    // 拖动开始：隐藏浮动元素
    if (miniInfo) miniInfo.className = 'mini-info';
    if (petBubble) petBubble.className = 'pet-bubble';
    petImage.style.animationPlayState = 'paused';
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  });

  petImage.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;
    if (hasDragged) {
      var newX = winStartX + dx;
      var newY = winStartY + dy;
      if (window.api && window.api.setWindowPos) {
        window.api.setWindowPos(newX, newY);
      }
    } else if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDragged = true;
    }
  });

  petImage.addEventListener('pointerup', function(e) {
    if (!dragging) return;
    dragging = false;
    petImage.style.cursor = 'grab';
    document.body.style.cursor = '';
    if (!hasDragged) {
      handlePetClick();
    } else {
      // 拖动结束，恢复动画
      petImage.style.animationPlayState = '';
    }
  });

  petImage.addEventListener('pointercancel', function() {
    dragging = false;
    petImage.style.cursor = 'grab';
    document.body.style.cursor = '';
    petImage.style.animationPlayState = '';
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
        if (diff < 0) diff += 24 * 60;
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
    clearTimeout(bubbleTimer);
    miniInfo.className = "mini-info show";
  };
  petImage.onmouseleave = function() {
    bubbleTimer = setTimeout(function() {
      miniInfo.className = "mini-info";
    }, 300);
  };

  // ==================== 点击展开对话面板 ====================
  async function handlePetClick() {
    petImage.classList.add('ripple');
    setTimeout(function() { petImage.classList.remove('ripple'); }, 600);
    toggleChatPanel();
  }

  // 打开计时器主窗口
  async function openTimerWindow() {
    try {
      if (window.api && window.api.showMain) {
        await window.api.showMain();
      } else {
        showMessage("请手动打开主计时器窗口");
      }
    } catch (err) {
      console.error("[Pet] 打开主窗口失败:", err);
      showMessage("打开计时器失败: " + err.message);
    }
  }

  // ==================== 星野对话 ====================
  var chatHistory = []; // 对话历史
  var chatLoading = false;
  var currentModel = 'qclaw'; // 默认模型
  var modelConfigs = {}; // 模型配置缓存

  // 加载模型配置
  async function loadModelConfigs() {
    try {
      if (window.api && window.api.getModelConfigs) {
        modelConfigs = await window.api.getModelConfigs();
        updateModelSelector();
      }
    } catch (e) {
      console.log('[Pet] 模型配置加载失败，使用默认');
    }
  }

  // 切换模型
  function switchModel(modelId) {
    currentModel = modelId;
    var modelNames = { qclaw: '星野', deepseek: 'DeepSeek', volcano: '火山引擎' };
    addChatMessage('已切换到: ' + (modelNames[modelId] || modelId), 'system');
  }

  // 更新模型选择器
  function updateModelSelector() {
    var selector = document.getElementById('petChatModel');
    if (!selector) return;
    selector.innerHTML = '';
    var models = [
      { id: 'qclaw', name: '⭐ 星野 (本地)' },
      { id: 'deepseek', name: '🤖 DeepSeek' },
      { id: 'volcano', name: '🌋 火山引擎' }
    ];
    models.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (m.id === currentModel) opt.selected = true;
      selector.appendChild(opt);
    });
  }

  function toggleChatPanel() {
    var isVisible = chatPanel.classList.contains('show');
    if (isVisible) {
      chatPanel.classList.remove('show');
    } else {
      chatPanel.classList.add('show');
      // 首次打开加载配置
      if (Object.keys(modelConfigs).length === 0) {
        loadModelConfigs();
      }
      // 聚焦输入框
      setTimeout(function() { if (chatInput) chatInput.focus(); }, 50);
    }
  }

  function addChatMessage(text, type) {
    if (!chatMessages) return;
    var div = document.createElement('div');
    div.className = 'pet-chat-msg ' + type;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function clearThinking() {
    var el = chatMessages.querySelector('.thinking');
    if (el) el.remove();
  }

  async function sendChatMessage() {
    if (chatLoading) return;
    var text = (chatInput.value || '').trim();
    if (!text) return;

    chatLoading = true;
    chatSendBtn.disabled = true;
    chatInput.value = '';

    // 显示用户消息
    addChatMessage(text, 'user');

    // 显示思考中（带模型名）
    var modelName = currentModel === 'qclaw' ? '星野' : (currentModel === 'deepseek' ? 'DeepSeek' : 'AI');
    addChatMessage(modelName + ' 思考中...', 'thinking');

    try {
      var result;
      if (window.api && window.api.sendChatMessage) {
        result = await window.api.sendChatMessage(text, currentModel);
      } else {
        result = { success: false, error: '对话接口不可用' };
      }

      clearThinking();

      if (result && result.success) {
        var reply = (result.reply || '').trim();
        if (reply) {
          addChatMessage(reply, 'ai');
          // 更新对话历史（保留最近20条）
          chatHistory.push({ role: 'user', content: text, model: currentModel });
          chatHistory.push({ role: 'assistant', content: reply, model: currentModel });
          if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
          // 保存历史
          saveChatHistory();
        } else {
          addChatMessage('（没有回复...）', 'ai');
        }
      } else {
        addChatMessage(result && result.error ? result.error : 'AI 开小差了，稍后再试试~', 'error');
      }
    } catch (err) {
      clearThinking();
      addChatMessage('对话失败: ' + err.message, 'error');
    } finally {
      chatLoading = false;
      chatSendBtn.disabled = false;
    }

    // 更新清空按钮状态
    updateClearButton();
  }

  // 保存/加载对话历史
  function saveChatHistory() {
    try {
      localStorage.setItem('petChatHistory', JSON.stringify(chatHistory));
    } catch (e) {}
  }

  function loadChatHistory() {
    try {
      var saved = localStorage.getItem('petChatHistory');
      if (saved) {
        chatHistory = JSON.parse(saved);
        // 恢复显示（只显示最近10条避免太长）
        var recent = chatHistory.slice(-10);
        recent.forEach(function(msg) {
          addChatMessage(msg.content, msg.role === 'user' ? 'user' : 'ai');
        });
      }
    } catch (e) {}
  }

  // 清空对话
  function clearChatHistory() {
    chatHistory = [];
    if (chatMessages) chatMessages.innerHTML = '';
    try {
      localStorage.removeItem('petChatHistory');
    } catch (e) {}
    updateClearButton();
  }

  function updateClearButton() {
    var btn = document.getElementById('petChatClear');
    if (btn) btn.style.display = chatHistory.length > 0 ? 'inline-flex' : 'none';
  }
  }

  // 绑定对话事件
  if (chatSendBtn) chatSendBtn.addEventListener('click', sendChatMessage);
  if (chatInput) {
    chatInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }
  if (chatCloseBtn) {
    chatCloseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      chatPanel.classList.remove('show');
    });
  }

  // 模型选择器
  var modelSelector = document.getElementById('petChatModel');
  if (modelSelector) {
    modelSelector.addEventListener('change', function(e) {
      switchModel(e.target.value);
    });
  }

  // 打开计时器按钮
  var openTimerBtn = document.getElementById('petOpenTimer');
  if (openTimerBtn) {
    openTimerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openTimerWindow();
    });
  }

  // 清空记录按钮
  var clearBtn = document.getElementById('petChatClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      clearChatHistory();
    });
  }

  // 初始化：加载历史记录
  loadChatHistory();

  // ==================== 关闭按钮 ====================
  petClose.onclick = function(e) {
    e.stopPropagation();
    if (chatPanel && chatPanel.classList.contains('show')) {
      chatPanel.classList.remove('show');
      return;
    }
    if (window.api && window.api.hidePet) {
      window.api.hidePet();
    } else {
      window.close();
    }
  };

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
    // 设置初始图片
    petImg.src = POSES.idle;
    petImg.style.transition = "opacity 0.28s ease";

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

    // 实时活动窗口状态检测（IPC 推送）
    if (window.api && window.api.onWindowState) {
      window.api.onWindowState(function(state) {
        console.log("[Pet] Window state ->", state);
        handleWindowState(state);
      });
      console.log("[Pet] 实时状态检测已启用");
    }

    // 锁屏/解锁宠物反应（气泡 + 特殊动画）
    if (window.api && window.api.onLockEvent) {
      window.api.onLockEvent(function(data) {
        console.log("[Pet] Lock event ->", data);
        if (data.type === 'locked') {
          // 锁屏：切到睡觉 + 气泡
          clearTimeout(poseTimer);
          isAlarmActive = false; // 解锁闹钟锁定
          switchPose('sleeping');
          petBubble.textContent = '主人晚安~ Zzz';
          petBubble.className = 'pet-bubble show';
          clearTimeout(bubblePoseTimer);
          bubblePoseTimer = setTimeout(function() {
            petBubble.className = 'pet-bubble';
          }, 5000);
        } else if (data.type === 'unlocked') {
          // 解锁：切到 idle + 欢迎气泡
          isAlarmActive = false;
          autoSwitchPose();
          var sleepMs = data.time ? (Date.now() - data.time) : 0;
          var sleepMin = Math.round(sleepMs / 60000);
          var msg = '主人回来啦~';
          if (sleepMin >= 60) {
            var h = Math.floor(sleepMin / 60);
            var m = sleepMin % 60;
            msg = '主人回来啦~ 我睡了好久' + (m > 0 ? ' (' + h + 'h' + m + 'm)' : ' (' + h + 'h)');
          } else if (sleepMin >= 2) {
            msg = '主人回来啦~ 我刚睡了 ' + sleepMin + ' 分钟';
          }
          petBubble.textContent = msg;
          petBubble.className = 'pet-bubble show';
          clearTimeout(bubblePoseTimer);
          bubblePoseTimer = setTimeout(function() {
            petBubble.className = 'pet-bubble';
          }, 5000);
        }
      });
      console.log("[Pet] 锁屏/解锁检测已启用");
    }

    // 主题同步
    if (window.api && window.api.onThemeChanged) {
      window.api.onThemeChanged(function(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem("zhiyu-theme", theme); } catch (e) {}
      });
    }
    try {
      var savedTheme = localStorage.getItem("zhiyu-theme");
      if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
    } catch (e) {}

    // 启动自动姿态切换（5秒后开始，给预加载时间）
    setTimeout(function() {
      autoSwitchPose();
    }, 5000);

    // 欢迎气泡
    setTimeout(function() {
      petBubble.textContent = "点击我打开计时器！";
      petBubble.className = "pet-bubble show";
      setTimeout(function() {
        petBubble.className = "pet-bubble";
      }, 4000);
    }, 1500);

    console.log("桌面宠物启动成功 ✓ (多姿态模式，12个表情自动切换)");
  }

  // ==================== 闹钟反应动画 ====================
  function triggerAlarmReaction(alarm) {
    var label = (alarm && alarm.label) ? alarm.label : "闹钟";
    console.log("[Pet] Alarm reaction triggered: " + label);

    // 锁定姿态，切换到庆祝
    isAlarmActive = true;
    clearTimeout(poseTimer);
    switchPose("celebrating");

    document.body.className = "alarm-flash";
    setTimeout(function() { document.body.className = ""; }, 2500);

    petImage.classList.add("alarm-shake");
    petBubble.textContent = "⏰ " + label + " 响啦！";
    petBubble.className = "pet-bubble alarm-bubble show";
    petStatus.className = "pet-status scheduled";

    // 10秒后停止闹钟状态
    setTimeout(function() {
      petImage.classList.remove("alarm-shake");
      isAlarmActive = false;
      console.log("[Pet] Alarm ended, resuming auto pose");
    }, 10000);
    setTimeout(function() {
      petBubble.className = "pet-bubble";
    }, 12000);
    setTimeout(function() {
      checkAlarms();
      // 恢复自动姿态切换
      schedulePoseTimer(5000);
    }, 7000);
  }

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
