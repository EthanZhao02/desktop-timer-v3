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

  var lastBubbleText = "";
  var POSE_BUBBLE_MS = 2500; // 气泡显示时长（精简提示，缩短为 2.5s）

  // 统一姿态气泡：同文本不重复弹出，避免连续切换时提示闪烁
  function showPoseBubble(text) {
    if (!petBubble || !text || isAlarmActive) return;
    clearTimeout(bubblePoseTimer);
    if (text === lastBubbleText && petBubble.className.indexOf("show") !== -1) return;
    lastBubbleText = text;
    petBubble.textContent = text;
    petBubble.className = "pet-bubble show";
    bubblePoseTimer = setTimeout(function() {
      if (!isAlarmActive) petBubble.className = "pet-bubble";
      lastBubbleText = "";
    }, POSE_BUBBLE_MS);
  }

  var currentPose = "idle";
  var currentPetState = "idle";
  var isAlarmActive = false;
  var poseTimer = null;
  var bubblePoseTimer = null;
  var motionTimer = null;
  var poseTransitionTimer = null;
  var motionPhaseTimer = null;
  var motionStartedAt = 0;
  var motionPausedUntil = 0;
  var turnPending = false;
  var motionBusy = false;
  var motionDirection = Math.random() < 0.5 ? -1 : 1;
  var autoMotionEnabled = localStorage.getItem('petAutoMotion') !== 'false';
  var petMotionMode = /^(mixed|roam|march)$/.test(localStorage.getItem('petMotionMode') || '')
    ? localStorage.getItem('petMotionMode')
    : 'mixed';
  var stateBeforeOverride = 'idle';
  var externalActivityState = 'idle';
  var externalActivityTimer = null;

  // ---- 2D 骨骼走路系统 ----
  var petBone = document.getElementById("petBone");
  var boneCanvas = document.getElementById("boneCanvas");
  var bEl = {
    fLeg: document.getElementById("fLeg"), fShin: document.getElementById("fShin"),
    bLeg: document.getElementById("bLeg"), bShin: document.getElementById("bShin"),
    upper: document.getElementById("bUpper")
  };
  var BONE_HF = {x:95,y:286}, BONE_KF = {x:62,y:314}, BONE_HB = {x:112,y:286}, BONE_KB = {x:140,y:314};
  var boneCfg = {
    speed: parseFloat(localStorage.getItem('petWalkSpeed') || '1.1'),
    amp:   parseFloat(localStorage.getItem('petWalkAmp')   || '26'),
    knee:  parseFloat(localStorage.getItem('petWalkKnee')  || '46')
  };
  var boneRAF=null, bonePhi=0, boneLast=0, boneMode=null, boneFacing=1, boneFitScale=0.414, bonePreviewTimer=null;

  var PET_STATES = {
    idle: { label: '待机', poses: ['idle', 'reading', 'coffee', 'phone', 'peeking'] },
    walk: { label: '慢走', poses: ['walking'], speed: 3 },
    run: { label: '跑步', poses: ['walking'], speed: 8 },
    sleep: { label: '睡觉', poses: ['sleeping'] },
    work: { label: '工作', poses: ['laptop', 'writing'] },
    music: { label: '听歌', poses: ['music'] },
    celebrate: { label: '闹钟庆祝', poses: ['celebrating'] },
    drag: { label: '拖动中', poses: ['walking'] },
    chat: { label: '对话', poses: ['thinking'] }
  };

  function setMotionPhase(phase, duration) {
    var container = document.getElementById('petContainer');
    if (!container) return;
    ['motion-starting', 'motion-moving', 'motion-stopping', 'motion-turning'].forEach(function(name) {
      container.classList.remove(name);
    });
    if (phase) container.classList.add('motion-' + phase);
    if (motionPhaseTimer) clearTimeout(motionPhaseTimer);
    motionPhaseTimer = null;
    if (duration) {
      motionPhaseTimer = setTimeout(function() {
        container.classList.remove('motion-' + phase);
        if (phase === 'starting' && (currentPetState === 'walk' || currentPetState === 'run')) {
          container.classList.add('motion-moving');
        }
        motionPhaseTimer = null;
      }, duration);
    }
  }

  function stopPetMotion(withTransition) {
    if (motionTimer) clearInterval(motionTimer);
    motionTimer = null;
    motionBusy = false;
    motionPausedUntil = 0;
    turnPending = false;
    setMotionPhase(withTransition ? 'stopping' : '', withTransition ? 240 : 0);
  }

  function startPetMotion(speed) {
    stopPetMotion(false);
    if (!autoMotionEnabled || !window.api || !window.api.movePetBy) return;
    var shouldMarch = petMotionMode === 'march' || (
      petMotionMode === 'mixed' && currentPetState === 'walk' && Math.random() < 0.5
    );
    if (shouldMarch) {
      setMotionPhase('moving');
      return;
    }
    motionStartedAt = Date.now();
    setMotionPhase('starting', 420);
    motionTimer = setInterval(async function() {
      if (motionBusy || dragging || isAlarmActive || currentPetState === 'chat' || Date.now() < motionPausedUntil) return;
      motionBusy = true;
      try {
        var acceleration = Math.min(1, 0.35 + ((Date.now() - motionStartedAt) / 520) * 0.65);
        var step = Math.max(1, Math.round(speed * acceleration));
        var result = await window.api.movePetBy(step * motionDirection, 0);
        if (!turnPending && result && ((motionDirection < 0 && result.hitLeft) || (motionDirection > 0 && result.hitRight))) {
          turnPending = true;
          motionPausedUntil = Date.now() + 300;
          setMotionPhase('turning', 300);
          setTimeout(function() {
            if (currentPetState !== 'walk' && currentPetState !== 'run') return;
            motionDirection *= -1;
            updatePetDirection();
          }, 140);
          setTimeout(function() {
            turnPending = false;
            if (currentPetState === 'walk' || currentPetState === 'run') setMotionPhase('moving');
          }, 300);
        }
      } catch (e) {
        stopPetMotion();
      } finally {
        motionBusy = false;
      }
    }, 50);
  }

  function updatePetDirection() {
    var container = document.getElementById('petContainer');
    // 原始人物素材朝左；向右移动时才需要水平镜像。
    if (container) container.classList.toggle('facing-right', motionDirection > 0);
    // 骨骼层同步翻转朝向（撞墙转身时也会走到这里），否则会倒着走
    if (typeof boneSetFacing === 'function') boneSetFacing();
  }

  // ==================== 2D 骨骼走路（FK 正向运动学） ====================
  function boneInit() {
    if (bEl.fLeg)  bEl.fLeg.style.transformOrigin  = BONE_HF.x+'px '+BONE_HF.y+'px';
    if (bEl.fShin) bEl.fShin.style.transformOrigin = BONE_KF.x+'px '+BONE_KF.y+'px';
    if (bEl.bLeg)  bEl.bLeg.style.transformOrigin  = BONE_HB.x+'px '+BONE_HB.y+'px';
    if (bEl.bShin) bEl.bShin.style.transformOrigin = BONE_KB.x+'px '+BONE_KB.y+'px';
    boneFit();
    window.addEventListener('resize', boneFit);
  }
  function boneFit() {
    if (!petImage) return;
    var h = petImage.clientHeight || 158;
    boneFitScale = h / 382;
    boneApplyTransform();
  }
  function boneApplyTransform() {
    if (!boneCanvas) return;
    // 缩放用 transform，水平镜像用独立 scale 属性（负缩放组合在部分环境不生效）
    boneCanvas.style.transform = 'scale(' + boneFitScale + ',' + boneFitScale + ')';
    boneCanvas.style.scale = (boneFacing < 0 ? '-1 1' : '1 1');
  }
  function boneSetFacing() {
    boneFacing = motionDirection > 0 ? -1 : 1;  // 素材朝左，向右走才水平镜像
    boneApplyTransform();
  }
  function boneStart(mode) {
    var container = document.getElementById('petContainer');
    if (container) container.classList.add('is-bone');
    boneMode = mode || 'walk';
    boneSetFacing();
    boneFit();
    if (!boneRAF) { boneLast = performance.now(); boneRAF = requestAnimationFrame(boneFrame); }
  }
  function boneStop() {
    var container = document.getElementById('petContainer');
    if (container) container.classList.remove('is-bone');
    boneMode = null;
    if (boneRAF) { cancelAnimationFrame(boneRAF); boneRAF = null; }
  }
  function boneFrame(now) {
    boneRAF = requestAnimationFrame(boneFrame);
    var dt = Math.min(0.05, (now - boneLast) / 1000); boneLast = now;
    var A, period, kneeMax, sp = Math.max(0.5, boneCfg.speed);
    if (boneMode === 'run')       { A = boneCfg.amp*1.25; period = 0.42/sp; kneeMax = boneCfg.knee*1.25; }
    else if (boneMode === 'march'){ A = boneCfg.amp*0.55; period = 0.72/sp; kneeMax = boneCfg.knee; }
    else                          { A = boneCfg.amp;      period = 0.72/sp; kneeMax = boneCfg.knee; }
    if (currentPetState !== 'drag') { bonePhi += dt * Math.PI * 2 / period; }
    var c = Math.cos(bonePhi), s = Math.sin(bonePhi);
    var kF = kneeMax * Math.max(0, -s);
    var kB = kneeMax * Math.max(0,  s);
    bEl.fLeg.style.transform  = 'rotate(' + (A*c - 50) + 'deg)';
    bEl.fShin.style.transform = 'rotate(' + (15 - kF) + 'deg)';
    bEl.bLeg.style.transform  = 'rotate(' + (45 - A*c) + 'deg)';
    bEl.bShin.style.transform = 'rotate(' + (kB - 20) + 'deg)';
    var bob = (boneMode === 'idle') ? 0 : Math.round(3 * Math.abs(c));
    bEl.upper.style.transform = 'translateY(' + bob + 'px)';
  }

  function setPetState(stateName, options) {
    var state = PET_STATES[stateName] || PET_STATES.idle;
    if (isAlarmActive && stateName !== 'celebrate') return;
    var previousState = currentPetState;
    var requested = PET_STATES[stateName] ? stateName : 'idle';

    // 相同状态去重：避免自动状态机反复随机重选姿态造成跳变。
    // 待机时允许随机换一个待机姿态（微动作，更生动）；有明确 pose 时只切姿态。
    if (requested === currentPetState) {
      if (options && options.pose && options.pose !== currentPose) {
        switchPose(options.pose);
      } else if (requested === 'idle' && !options && state.poses.length > 1) {
        switchPose(randomPick(state.poses));
      }
      return;
    }

    currentPetState = requested;
    var container = document.getElementById('petContainer');
    if (container) {
      Object.keys(PET_STATES).forEach(function(name) { container.classList.remove('state-' + name); });
      container.classList.add('state-' + currentPetState);
    }
    var label = document.getElementById('petStateLabel');
    if (label) label.textContent = state.label;
    var poses = state.poses;
    var pose = options && options.pose ? options.pose : poses[Math.floor(Math.random() * poses.length)];
    switchPose(pose);
    updatePetDirection();
    if (state.speed) startPetMotion(state.speed);
    else stopPetMotion(previousState === 'walk' || previousState === 'run');
    console.log('[Pet] State -> ' + currentPetState);
  }

  // 预加载所有图片（确保切换无延迟）
  var preloadedImages = {};
  Object.keys(POSES).forEach(function(key) {
    var img = new Image();
    img.src = POSES[key];
    preloadedImages[key] = img;
  });

  // 切换姿态（带淡入淡出过渡）
  function switchPose(poseName) {
    if (isAlarmActive && poseName !== "celebrating") return false;
    if (!POSES[poseName]) return false;

    // ---- 走路 / 跑步 / 拖动：使用 2D 骨骼动画 ----
    if (poseName === "walking") {
      var walkMode = (currentPetState === 'run') ? 'run' : 'walk';
      if (poseName === currentPose && boneRAF) { boneStart(walkMode); return false; }
      currentPose = "walking";
      if (poseTransitionTimer) clearTimeout(poseTransitionTimer);
      poseTransitionTimer = null;
      petImg.style.opacity = "0";
      boneStart(walkMode);
      if (!isAlarmActive) showPoseBubble(poseBubbles["walking"]);
      console.log("[Pet] Bone walk -> " + walkMode);
      return true;
    }

    // ---- 从骨骼姿态切回普通姿态：先准备图片，再隐藏骨骼层，避免闪白 ----
    if (boneMode) {
      if (poseTransitionTimer) clearTimeout(poseTransitionTimer);
      poseTransitionTimer = null;
      currentPose = poseName;
      petImg.src = POSES[poseName];
      petImg.style.opacity = "1";
      boneStop();
      if (!isAlarmActive) showPoseBubble(poseBubbles[poseName]);
      console.log("[Pet] Pose -> " + poseName);
      return true;
    }

    if (poseName === currentPose && !isAlarmActive) {
      if (poseTransitionTimer) clearTimeout(poseTransitionTimer);
      poseTransitionTimer = null;
      petImg.style.opacity = "1";
      return false;
    }

    currentPose = poseName;
    if (poseTransitionTimer) clearTimeout(poseTransitionTimer);
    // 淡出
    petImg.style.opacity = "0";

    poseTransitionTimer = setTimeout(function() {
      petImg.src = POSES[poseName];
      // 淡入
      petImg.style.opacity = "1";
      if (!isAlarmActive) showPoseBubble(poseBubbles[poseName]);
      poseTransitionTimer = null;
    }, 280);

    console.log("[Pet] Pose -> " + poseName);
    return true;
  }

  // 随机选取一个姿态（排除当前）
  function randomPick(arr) {
    var filtered = arr.filter(function(p) { return p !== currentPose; });
    if (filtered.length === 0) filtered = arr;
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  // 自动姿态切换（基于时间 + 随机）
  function autoSwitchPose() {
    if (externalActivityState === 'work' || externalActivityState === 'music') {
      if (currentPetState !== externalActivityState && !dragging && currentPetState !== 'chat') {
        setPetState(externalActivityState);
      }
      schedulePoseTimer(5000);
      return;
    }
    if (isAlarmActive || dragging || currentPetState === 'chat') {
      schedulePoseTimer(3000);
      return;
    }

    var now = new Date();
    var hour = now.getHours();
    var day = now.getDay(); // 0=Sunday

    // 深夜 (0:00-6:00): 睡觉
    if (hour >= 0 && hour < 6) {
      setPetState("sleep");
      schedulePoseTimer(40000 + Math.random() * 20000);
      return;
    }

    // 清晨 (6:00-8:00): 咖啡或走路
    if (hour >= 6 && hour < 8) {
      var morningR = Math.random();
      setPetState(morningR < 0.55 ? "walk" : (morningR < 0.65 ? "run" : "idle"));
      schedulePoseTimer(14000 + Math.random() * 9000);
      return;
    }

    // 工作时间 (8:00-18:00 工作日): 混合工作和休闲
    if (hour >= 8 && hour < 18 && day >= 1 && day <= 5) {
      var r = Math.random();
      if (r < 0.30) {
        // 30% 工作姿态
        setPetState("work");
      } else if (r < 0.45) {
        // 15% 慢走
        setPetState("walk");
      } else if (r < 0.53) {
        // 8% 跑步
        setPetState("run");
      } else {
        // 47% 休闲待机
        setPetState("idle");
      }
      schedulePoseTimer(14000 + Math.random() * 10000);
      return;
    }

    // 晚间/周末: 以休闲为主，偶尔特殊
    var eveningR = Math.random();
    if (eveningR < 0.18) {
      setPetState("walk");
    } else if (eveningR < 0.26) {
      setPetState("run");
    } else if (eveningR < 0.41) {
      setPetState("music");
    } else {
      setPetState("idle");
    }
    schedulePoseTimer(14000 + Math.random() * 10000);
  }

  function schedulePoseTimer(ms) {
    clearTimeout(poseTimer);
    poseTimer = setTimeout(autoSwitchPose, ms);
  }

  // ==================== 实时状态检测 ====================
  var windowStateActive = false; // 标记是否正在使用实时检测
  var windowStateTimer = null;
  var lastActivityKey = '';

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
    if (isAlarmActive || externalActivityState === 'work' || externalActivityState === 'music') return;

    var proc = (state.process || '').toLowerCase().replace(/\.exe$/i, '');
    var idleMs = state.idleMs || 0;
    var locked = state.locked || false;
    var idleBand = locked ? 'locked' : (idleMs > 300000 ? 'sleep' : (idleMs > 120000 ? 'thinking' : 'active'));
    var activityKey = idleBand + ':' + (idleBand === 'active' ? proc : '');
    if (activityKey === lastActivityKey) return;
    lastActivityKey = activityKey;

    windowStateActive = true;
    clearTimeout(poseTimer);

    // 锁屏 → 睡觉
    if (locked || proc === 'lockscreen' || proc === 'lockapp') {
      setPetState('sleep');
      switchPoseWithBubble("sleeping", "Zzz... (锁屏中)");
      return;
    }

    // 空闲超过5分钟 → 睡觉
    if (idleMs > 300000) {
      setPetState('sleep');
      switchPoseWithBubble("sleeping", "Zzz... (发呆中)");
      return;
    }

    // 空闲超过2分钟 → 思考
    if (idleMs > 120000) {
      setPetState('idle', { pose: 'thinking' });
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
      if (matched.pose === 'music') setPetState('music');
      else if (matched.pose === 'laptop' || matched.pose === 'writing') setPetState('work', { pose: matched.pose });
      else setPetState('idle', { pose: matched.pose });
      switchPoseWithBubble(matched.pose, matched.bubble);
    } else {
      // 未知程序不覆盖当前动作，让自动状态机继续决定待机、走路或跑步。
    }

    // 前台程序提示短暂展示后恢复自动行为；普通轮询不会重复延长这个计时。
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(function() {
      windowStateActive = false;
      autoSwitchPose();
    }, matched ? 8000 : 2500);
  }

  // 带气泡的姿态切换（气泡延迟 300ms 展示，避免与淡入重叠）
  function switchPoseWithBubble(poseName, bubble) {
    if (poseName !== currentPose) switchPose(poseName);
    if (bubble && !isAlarmActive) {
      clearTimeout(bubblePoseTimer);
      setTimeout(function() {
        showPoseBubble(bubble);
      }, 300);
    }
  }

  // ==================== JS拖动（无webkit-app-region: drag干扰点击和动画）====================
  petImage.style['-webkit-app-region'] = 'no-drag';
  petImage.style.cursor = 'grab';

  var dragging = false;
  var dragStartX = 0, dragStartY = 0;
  var dragStartClientX = 0, dragStartClientY = 0;
  var winStartX = 0, winStartY = 0;
  var hasDragged = false;

  // 透明区域允许鼠标穿透；进入宠物本体或控件时恢复交互。
  var petMouseEventsEnabled = null;

  // 交互区域：以角色中心为椭圆（角色素材整体呈竖椭圆，主体约占宽 110% / 高 150%），
  // 覆盖角色头部、手臂、尾巴等可见边缘，透明四角不再误触。
  function pointInPetEllipse(x, y) {
    var rect = petImage.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var rx = rect.width * 0.55;
    var ry = rect.height * 0.75;
    var dx = (x - cx) / rx;
    var dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  function isInsidePetInteractionArea(x, y) {
    return pointInPetEllipse(x, y);
  }

  var petHitTestPending = false;
  function updatePetHitTesting(e) {
    if (!window.api || !window.api.setPetMouseEvents || petHitTestPending) return;
    // mousemove 高频触发，用 rAF 节流到帧级别
    petHitTestPending = true;
    requestAnimationFrame(function() {
      petHitTestPending = false;
      var target = document.elementFromPoint(e.clientX, e.clientY);
      var controlHit = Boolean(target && target.closest('#petClose, #petChatPanel, #petSettingsPanel, #petTime, #miniInfo'));
      // 人物椭圆范围始终保持可交互。透明像素和骨骼动画不再造成拖动死区。
      var interactive = dragging || controlHit || isInsidePetInteractionArea(e.clientX, e.clientY);
      var petContainer = document.getElementById('petContainer');
      if (petContainer) petContainer.classList.toggle('controls-visible', interactive);
      if (interactive === petMouseEventsEnabled) return;
      petMouseEventsEnabled = interactive;
      window.api.setPetMouseEvents(interactive);
    });
  }
  document.addEventListener('mousemove', updatePetHitTesting);
  document.addEventListener('mouseleave', function() {
    var petContainer = document.getElementById('petContainer');
    if (petContainer) petContainer.classList.remove('controls-visible');
    if (!dragging && petMouseEventsEnabled !== false && window.api && window.api.setPetMouseEvents) {
      petMouseEventsEnabled = false;
      window.api.setPetMouseEvents(false);
    }
  });

  petImage.addEventListener('pointerdown', function(e) {
    if (e.button !== 0) return;
    // 任意位置都允许开始拖动；透明四角"单击不误触"在松手时再判定。
    dragging = true;
    stateBeforeOverride = currentPetState;
    hasDragged = false;
    // 先记录起点（即使 setPetState 异常也不影响拖动坐标）
    dragStartX = e.screenX;
    dragStartY = e.screenY;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    winStartX = window.screenX;
    winStartY = window.screenY;
    setPetState('drag');
    petMouseEventsEnabled = true;
    if (window.api && window.api.setPetMouseEvents) window.api.setPetMouseEvents(true);
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
    // 用 clientX/clientY 差值（CSS 像素 = 窗口 DIP）移动窗口，
    // 避免高分屏缩放下 screenX（物理像素）与 window.screenX（DIP）混用导致漂移。
    var dx = e.clientX - dragStartClientX;
    var dy = e.clientY - dragStartClientY;
    if (!hasDragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      hasDragged = true;
    }
    if (hasDragged) {
      var newX = winStartX + dx;
      var newY = winStartY + dy;
      if (window.api && window.api.setWindowPos) {
        window.api.setWindowPos(newX, newY);
      }
    }
  });

  petImage.addEventListener('pointerup', function(e) {
    if (!dragging) return;
    dragging = false;
    if (petImage.hasPointerCapture(e.pointerId)) {
      petImage.releasePointerCapture(e.pointerId);
    }
    petImage.style.cursor = 'grab';
    document.body.style.cursor = '';
    if (!hasDragged) {
      setPetState(stateBeforeOverride === 'drag' ? 'idle' : stateBeforeOverride);
      // 只在角色椭圆内单击才打开计时器，透明四角单击不误触
      if (pointInPetEllipse(e.clientX, e.clientY)) {
        handlePetClick();
      }
    } else {
      // 拖动结束，恢复动画
      petImage.style.animationPlayState = '';
      setPetState('idle');
      schedulePoseTimer(5000);
    }
  });

  petImage.addEventListener('pointercancel', function(e) {
    dragging = false;
    if (petImage.hasPointerCapture(e.pointerId)) {
      petImage.releasePointerCapture(e.pointerId);
    }
    petImage.style.cursor = 'grab';
    document.body.style.cursor = '';
    petImage.style.animationPlayState = '';
    setPetState('idle');
    schedulePoseTimer(5000);
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
        // 状态提示精简：只显示最近闹钟时间，不再拼接"x小时x分后"长文案
        nextAlarmTime.textContent = nearest.time;
        petStatus.className = "pet-status scheduled";  // 有闹钟设置 = 紫色
      } else {
        petStatus.className = "pet-status";  // 默认 = 绿色
        nextAlarmTime.textContent = "--:--";
      }
    } catch (e) {}
  }

  // ==================== 鼠标悬停提示 ====================
  var bubbleTimer = null;
  petImage.onmouseenter = function() {
    clearTimeout(bubbleTimer);
    if (petBubble) petBubble.className = "pet-bubble";
    miniInfo.className = "mini-info show";
  };
  petImage.onmouseleave = function() {
    bubbleTimer = setTimeout(function() {
      miniInfo.className = "mini-info";
    }, 300);
  };

  // ==================== 单击/双击处理 ====================
  var clickCount = 0;
  var clickTimer = null;

  async function handlePetClick() {
    clickCount++;

    if (clickCount === 1) {
      // 等待可能的第二次点击
      clickTimer = setTimeout(function() {
        // 单击：打开计时器
        clickCount = 0;
        petImage.classList.add('ripple');
        setTimeout(function() { petImage.classList.remove('ripple'); }, 600);
        openTimerWindow();
      }, 250); // 250ms 内双击判定
    } else if (clickCount === 2) {
      // 双击：打开对话面板
      clearTimeout(clickTimer);
      clickCount = 0;
      petImage.classList.add('ripple');
      setTimeout(function() { petImage.classList.remove('ripple'); }, 600);
      toggleChatPanel();
    }
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

  // ==================== API 设置面板 ====================
  var settingsPanel = document.getElementById('petSettingsPanel');
  var apiNotice = document.getElementById('apiNotice');

  function syncPanelVisibility() {
    var chatVisible = chatPanel && chatPanel.classList.contains('show');
    var settingsVisible = settingsPanel && settingsPanel.classList.contains('show');
    if (chatVisible || settingsVisible) {
      if (currentPetState !== 'chat') stateBeforeOverride = currentPetState;
      setPetState('chat');
    } else if (currentPetState === 'chat') {
      setPetState(stateBeforeOverride === 'chat' ? 'idle' : stateBeforeOverride);
      schedulePoseTimer(5000);
    }
    if (window.api && window.api.setPanelVisible) {
      window.api.setPanelVisible(Boolean(chatVisible || settingsVisible));
    }
  }


  // 加载保存的 API Key
  async function loadSavedApiKeys() {
    try {
      if (window.api && window.api.getApiKeys) {
        var keys = await window.api.getApiKeys();
        if (keys.deepseek) modelConfigs.deepseek = { apiKey: keys.deepseek };
        if (keys.volcano) modelConfigs.volcano = { apiKey: keys.volcano };
      }
    } catch (e) {
      console.log('[Pet] 加载 API Key 失败:', e);
    }
  }

  // 显示/隐藏设置面板
  function toggleSettingsPanel(show) {
    if (!settingsPanel) return;
    if (show) {
      // 填充当前值和状态指示器
      var deepseekInput = document.getElementById('deepseekKeyInput');
      var volcanoInput = document.getElementById('volcanoKeyInput');
      var deepseekStatus = document.getElementById('deepseekStatus');
      var volcanoStatus = document.getElementById('volcanoStatus');
      var motionToggle = document.getElementById('petAutoMotion');
      if (motionToggle) motionToggle.checked = autoMotionEnabled;

      var hasDeepseek = modelConfigs.deepseek && modelConfigs.deepseek.apiKey;
      var hasVolcano = modelConfigs.volcano && modelConfigs.volcano.apiKey;

      if (deepseekInput) deepseekInput.value = hasDeepseek ? modelConfigs.deepseek.apiKey : '';
      if (volcanoInput) volcanoInput.value = hasVolcano ? modelConfigs.volcano.apiKey : '';
      if (deepseekStatus) {
        deepseekStatus.textContent = hasDeepseek ? '已配置 ✅' : '未配置';
        deepseekStatus.className = 'settings-status' + (hasDeepseek ? ' configured' : '');
      }
      if (volcanoStatus) {
        volcanoStatus.textContent = hasVolcano ? '已配置 ✅' : '未配置';
        volcanoStatus.className = 'settings-status' + (hasVolcano ? ' configured' : '');
      }
      settingsPanel.classList.add('show');
      syncPanelVisibility();
    } else {
      settingsPanel.classList.remove('show');
      syncPanelVisibility();
    }
  }

  // 保存 API Key
  async function saveApiKeys() {
    var deepseekKey = document.getElementById('deepseekKeyInput').value.trim();
    var volcanoKey = document.getElementById('volcanoKeyInput').value.trim();
    var motionToggle = document.getElementById('petAutoMotion');
    autoMotionEnabled = motionToggle ? motionToggle.checked : autoMotionEnabled;
    localStorage.setItem('petAutoMotion', autoMotionEnabled ? 'true' : 'false');

    // 更新本地配置
    if (deepseekKey) modelConfigs.deepseek = { apiKey: deepseekKey };
    if (volcanoKey) modelConfigs.volcano = { apiKey: volcanoKey };

    // 保存到主进程
    try {
      if (window.api && window.api.saveApiKeys) {
        await window.api.saveApiKeys({
          deepseek: deepseekKey,
          volcano: volcanoKey
        });
      }
    } catch (e) {
      console.log('[Pet] 保存 API Key 失败:', e);
    }

    // 重新加载配置确保同步
    await loadModelConfigs();

    // 更新状态指示器
    var deepseekStatus = document.getElementById('deepseekStatus');
    var volcanoStatus = document.getElementById('volcanoStatus');
    if (deepseekStatus) {
      deepseekStatus.textContent = deepseekKey ? '已配置 ✅' : '未配置';
      deepseekStatus.className = 'settings-status' + (deepseekKey ? ' configured' : '');
    }
    if (volcanoStatus) {
      volcanoStatus.textContent = volcanoKey ? '已配置 ✅' : '未配置';
      volcanoStatus.className = 'settings-status' + (volcanoKey ? ' configured' : '');
    }

    toggleSettingsPanel(false);
    if (!autoMotionEnabled && (currentPetState === 'walk' || currentPetState === 'run')) {
      setPetState('idle');
    }
    // 检查当前模型是否需要 API Key
    checkApiKeyNotice();
  }

  // 检查并显示 API Key 提示
  function checkApiKeyNotice() {
    if (!apiNotice) return;
    var noticeText = apiNotice.querySelector('.api-notice-text');

    if (currentModel === 'deepseek' && !modelConfigs.deepseek) {
      noticeText.textContent = 'DeepSeek 需要配置 API Key';
      apiNotice.style.display = 'flex';
    } else if (currentModel === 'volcano' && !modelConfigs.volcano) {
      noticeText.textContent = '火山引擎需要配置 API Key';
      apiNotice.style.display = 'flex';
    } else {
      apiNotice.style.display = 'none';
    }
  }

  // 绑定设置面板事件
  function bindSettingsEvents() {
    // 设置按钮
    var settingsBtn = document.getElementById('apiSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSettingsPanel(true);
      });
    }

    // 关闭按钮
    var closeBtn = document.getElementById('settingsClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSettingsPanel(false);
      });
    }

    // 取消按钮
    var cancelBtn = document.getElementById('settingsCancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSettingsPanel(false);
      });
    }

    // 保存按钮
    var saveBtn = document.getElementById('settingsSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        saveApiKeys();
      });
    }

    // 自动运动开关立即生效，不依赖保存 API Key。
    var motionToggle = document.getElementById('petAutoMotion');
    if (motionToggle) {
      motionToggle.checked = autoMotionEnabled;
      motionToggle.addEventListener('change', function(e) {
        e.stopPropagation();
        autoMotionEnabled = motionToggle.checked;
        localStorage.setItem('petAutoMotion', autoMotionEnabled ? 'true' : 'false');
        if (!autoMotionEnabled && (currentPetState === 'walk' || currentPetState === 'run')) {
          setPetState('idle');
        } else if (autoMotionEnabled) {
          schedulePoseTimer(1000);
        }
      });
    }

    // 设置选项卡切换
    var settingTabs = document.querySelectorAll('.settings-tab');
    var settingTabPages = document.querySelectorAll('.settings-tabpage');
    settingTabs.forEach(function(tabBtn) {
      tabBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        settingTabs.forEach(function(b){ b.classList.remove('active'); });
        settingTabPages.forEach(function(p){ p.classList.remove('active'); });
        tabBtn.classList.add('active');
        var page = document.getElementById('tabpage-' + tabBtn.dataset.tab);
        if (page) page.classList.add('active');
      });
    });

    // 走路骨骼动作调试
    function bindTune(inputId, cfgKey, storageKey) {
      var input = document.getElementById(inputId);
      if (!input) return;
      input.value = boneCfg[cfgKey];
      var valEl = document.getElementById(inputId + 'Val');
      if (valEl) valEl.textContent = '' + input.value;
      input.addEventListener('click', function(e){ e.stopPropagation(); });
      input.addEventListener('mousedown', function(e){ e.stopPropagation(); });
      input.addEventListener('input', function(e) {
        e.stopPropagation();
        boneCfg[cfgKey] = parseFloat(input.value);
        localStorage.setItem(storageKey, input.value);
        if (valEl) valEl.textContent = '' + input.value;
      });
    }
    bindTune('walkSpeed', 'speed', 'petWalkSpeed');
    bindTune('walkAmp',   'amp',   'petWalkAmp');
    bindTune('walkKnee',  'knee',  'petWalkKnee');
    var walkPreviewBtn = document.getElementById('walkPreviewBtn');
    if (walkPreviewBtn) {
      walkPreviewBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSettingsPanel(false);
        if (motionTimer) { clearInterval(motionTimer); motionTimer = null; }
        clearTimeout(poseTimer);
        clearTimeout(bonePreviewTimer);
        boneStart('march');
        showMessage('原地踏步预览，5秒后恢复');
        bonePreviewTimer = setTimeout(function() {
          boneStop();
          setPetState('idle');
          schedulePoseTimer(3000);
        }, 5000);
      });
    }

    // 显示/隐藏密码
    var toggleDeepseek = document.getElementById('toggleDeepseek');
    var deepseekInput = document.getElementById('deepseekKeyInput');
    if (toggleDeepseek && deepseekInput) {
      toggleDeepseek.addEventListener('click', function(e) {
        e.stopPropagation();
        if (deepseekInput.type === 'password') {
          deepseekInput.type = 'text';
          toggleDeepseek.textContent = '隐藏';
        } else {
          deepseekInput.type = 'password';
          toggleDeepseek.textContent = '显示';
        }
      });
    }

    var toggleVolcano = document.getElementById('toggleVolcano');
    var volcanoInput = document.getElementById('volcanoKeyInput');
    if (toggleVolcano && volcanoInput) {
      toggleVolcano.addEventListener('click', function(e) {
        e.stopPropagation();
        if (volcanoInput.type === 'password') {
          volcanoInput.type = 'text';
          toggleVolcano.textContent = '隐藏';
        } else {
          volcanoInput.type = 'password';
          toggleVolcano.textContent = '显示';
        }
      });
    }
  }

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
    // 检查是否需要 API Key
    checkApiKeyNotice();
  }

  // 更新模型选择器
  function updateModelSelector() {
    var selector = document.getElementById('petChatModel');
    if (!selector) return;
    // HTML 中已定义选项，这里只确保当前模型被选中
    for (var i = 0; i < selector.options.length; i++) {
      if (selector.options[i].value === currentModel) {
        selector.selectedIndex = i;
        break;
      }
    }
  }

  function toggleChatPanel() {
    var isVisible = chatPanel.classList.contains('show');
    if (isVisible) {
      chatPanel.classList.remove('show');
      syncPanelVisibility();
    } else {
      chatPanel.classList.add('show');
      syncPanelVisibility();
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

  // 显示/隐藏输入区状态指示器
  function showStatus(text, type) {
    var el = document.getElementById('chatStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'pet-chat-status ' + (type || '');
    el.style.display = 'block';
  }
  function hideStatus() {
    var el = document.getElementById('chatStatus');
    if (!el) return;
    el.style.display = 'none';
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

    // 显示思考中（带模型名）- 显示在宠物气泡里
    var modelName = currentModel === 'qclaw' ? '星野' : (currentModel === 'deepseek' ? 'DeepSeek' : 'AI');
    addChatMessage(modelName + ' 思考中...', 'thinking');
    // 在宠物气泡显示思考状态
    petBubble.textContent = modelName + ' 思考中...';
    petBubble.className = 'pet-bubble show thinking-bubble';

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
          // 在宠物气泡显示完成状态
          petBubble.textContent = '已回复~';
          petBubble.className = 'pet-bubble show done-bubble';
          setTimeout(function() {
            petBubble.classList.remove('show');
          }, 3000);
        } else {
          addChatMessage('（没有回复...）', 'ai');
          // 在宠物气泡显示完成状态
          petBubble.textContent = '已回复（无内容）';
          petBubble.className = 'pet-bubble show done-bubble';
          setTimeout(function() {
            petBubble.classList.remove('show');
          }, 3000);
        }
      } else {
        clearThinking();
        addChatMessage(result && result.error ? result.error : 'AI 开小差了，稍后再试试~', 'error');
        // 在宠物气泡显示失败状态
        petBubble.textContent = '回复失败...';
        petBubble.className = 'pet-bubble show error-bubble';
        setTimeout(function() {
          petBubble.classList.remove('show');
        }, 3000);
      }
    } catch (err) {
      clearThinking();
      addChatMessage('对话失败: ' + err.message, 'error');
      // 在宠物气泡显示失败状态
      petBubble.textContent = '对话失败...';
      petBubble.className = 'pet-bubble show error-bubble';
      setTimeout(function() {
        petBubble.classList.remove('show');
      }, 3000);
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

  // ==================== 事件绑定（在 init 中统一绑定）====================
  function bindChatEvents() {
    // 设置面板事件
    bindSettingsEvents();
    // 发送按钮
    var sendBtn = document.getElementById('petChatSend');
    if (sendBtn) {
      sendBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        sendChatMessage();
      });
    }

    // 输入框回车
    var input = document.getElementById('petChatInput');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    }

    // 关闭按钮（面板内）
    var closeBtn = document.getElementById('petChatClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var panel = document.getElementById('petChatPanel');
        if (panel) {
          panel.classList.remove('show');
          syncPanelVisibility();
        }
      });
    }

    // 模型选择器
    var modelSel = document.getElementById('petChatModel');
    if (modelSel) {
      modelSel.addEventListener('change', function(e) {
        switchModel(e.target.value);
      });
    }

    // 打开计时器按钮
    var timerBtn = document.getElementById('petOpenTimer');
    if (timerBtn) {
      timerBtn.addEventListener('click', function(e) {
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

    // 设置按钮
    var settingsBtn = document.getElementById('petOpenSettings');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleSettingsPanel(true);
      });
    }
  }

  // ==================== 关闭按钮 ====================
  petClose.onclick = function(e) {
    e.stopPropagation();
    if (chatPanel && chatPanel.classList.contains('show')) {
      chatPanel.classList.remove('show');
      syncPanelVisibility();
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
    petImg.style.transition = "opacity 0.28s ease";
    boneInit();
    setPetState('idle');

    // 主程序设置改动走路参数时实时同步
    window.addEventListener('storage', function(e) {
      if (!e.newValue) return;
      if (e.key === 'petWalkSpeed') boneCfg.speed = Math.max(0.5, parseFloat(e.newValue) || 1.1);
      else if (e.key === 'petWalkAmp') boneCfg.amp = parseFloat(e.newValue) || 26;
      else if (e.key === 'petWalkKnee') boneCfg.knee = parseFloat(e.newValue) || 46;
      else if (e.key === 'petAutoMotion') {
        autoMotionEnabled = (e.newValue === 'true');
        if (!autoMotionEnabled && (currentPetState === 'walk' || currentPetState === 'run')) setPetState('idle');
        else if (autoMotionEnabled) schedulePoseTimer(500);
      }
      else if (e.key === 'petMotionMode' && /^(mixed|roam|march)$/.test(e.newValue)) {
        petMotionMode = e.newValue;
        if (currentPetState === 'walk' || currentPetState === 'run') {
          startPetMotion(PET_STATES[currentPetState].speed);
        }
      }
      else if (e.key === 'petWalkPreview') {
        try {
          var c = document.getElementById('petContainer');
          if (c) c.classList.add('is-bone');
          boneStart('march');
          setTimeout(function(){
            if (currentPetState !== 'walk' && currentPetState !== 'run') boneStop();
          }, 5200);
        } catch(err) {}
      }
    });

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

    if (window.api && window.api.onPetActivity) {
      window.api.onPetActivity(function(activity) {
        applyExternalActivity(activity);
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
          setPetState('sleep');
          showPoseBubble('主人晚安~ Zzz');
        } else if (data.type === 'unlocked') {
          // 解锁：切到 idle + 欢迎气泡（精简文案）
          isAlarmActive = false;
          if (externalActivityState === 'work' || externalActivityState === 'music') {
            setPetState(externalActivityState);
          } else {
            setPetState('idle');
            autoSwitchPose();
          }
          var sleepMs = data.time ? (Date.now() - data.time) : 0;
          var sleepMin = Math.round(sleepMs / 60000);
          var msg = '主人回来啦~';
          if (sleepMin >= 60) {
            var h = Math.floor(sleepMin / 60);
            var m = sleepMin % 60;
            msg = '主人回来啦~ 睡了 ' + h + 'h' + (m > 0 ? m + 'm' : '');
          } else if (sleepMin >= 2) {
            msg = '主人回来啦~ 睡了 ' + sleepMin + ' 分钟';
          }
          showPoseBubble(msg);
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

    // 绑定对话面板事件（确保DOM已加载）
    bindChatEvents();

    // 加载保存的 API Key
    loadSavedApiKeys();

    // 启动自动姿态切换（3秒后开始，给预加载时间）
    setTimeout(function() {
      autoSwitchPose();
    }, 3000);

    // 欢迎气泡
    setTimeout(function() {
      petBubble.textContent = "点击我打开计时器！";
      petBubble.className = "pet-bubble show";
      setTimeout(function() {
        petBubble.className = "pet-bubble";
      }, 4000);
    }, 1500);

    // 自动化测试钩子（只读内部状态，供 tests/pet-interaction.js 断言使用）
    try {
      window.__petTest = {
        get state() { return currentPetState; },
        get pose() { return currentPose; },
        get isDragging() { return dragging; },
        get hasDragged() { return hasDragged; },
        get bubbleText() { return petBubble ? petBubble.textContent : ''; },
        get bubbleShown() { return petBubble ? petBubble.className.indexOf('show') !== -1 : false; },
        get lastBubbleText() { return lastBubbleText; },
        isInsidePetInteractionArea: isInsidePetInteractionArea,
        setPetState: setPetState,
        switchPose: switchPose,
        switchPoseWithBubble: switchPoseWithBubble,
        showPoseBubble: showPoseBubble
      };
    } catch (_) {}

    console.log("桌面宠物启动成功 ✓ (多姿态模式，12个表情自动切换)");
  }

  function applyExternalActivity(activity) {
    if (!activity || !PET_STATES[activity.state]) return;
    if (externalActivityTimer) clearTimeout(externalActivityTimer);
    externalActivityTimer = null;

    if (activity.state === 'celebrate') {
      var restoreState = activity.restoreState === 'work' || activity.restoreState === 'music'
        ? activity.restoreState
        : 'idle';
      externalActivityState = restoreState;
      clearTimeout(poseTimer);
      setPetState('celebrate');
      petBubble.textContent = activity.source === 'countdown-complete' ? '倒计时完成啦！' : '完成啦！';
      petBubble.className = 'pet-bubble show';
      externalActivityTimer = setTimeout(function() {
        setPetState(externalActivityState);
        if (externalActivityState === 'idle') schedulePoseTimer(5000);
        petBubble.className = 'pet-bubble';
      }, activity.duration || 8000);
      return;
    }

    externalActivityState = activity.state === 'work' || activity.state === 'music'
      ? activity.state
      : 'idle';
    if (dragging || currentPetState === 'chat' || isAlarmActive) return;
    clearTimeout(poseTimer);
    setPetState(externalActivityState);
    if (externalActivityState === 'idle') schedulePoseTimer(5000);
  }

  // ==================== 闹钟反应动画 ====================
  function triggerAlarmReaction(alarm) {
    var label = (alarm && alarm.label) ? alarm.label : "闹钟";
    console.log("[Pet] Alarm reaction triggered: " + label);

    // 锁定姿态，切换到庆祝
    isAlarmActive = true;
    clearTimeout(poseTimer);
    setPetState("celebrate");

    document.body.className = "alarm-flash";
    setTimeout(function() { document.body.className = ""; }, 2500);

    petImage.classList.add("alarm-shake");
    petBubble.textContent = "⏰ " + label + " 响啦！";
    petBubble.className = "pet-bubble alarm-bubble show";
    petStatus.className = "pet-status alarm-active";  // 闹钟响 = 红色闪烁

    // 10秒后停止闹钟状态
    setTimeout(function() {
      petImage.classList.remove("alarm-shake");
      isAlarmActive = false;
      setPetState(externalActivityState);
      if (externalActivityState === 'idle') schedulePoseTimer(5000);
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
