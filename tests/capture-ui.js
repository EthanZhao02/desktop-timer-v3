const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const PET_WINDOW_WIDTH = 220;
const PET_WINDOW_HEIGHT = 280;
const PET_PANEL_WIDTH = 440;
const PET_PANEL_HEIGHT = 600;

app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', (event) => event.preventDefault());

async function capture(file, width, height, output, options = {}) {
  const errors = [];
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: options.frame !== false,
    transparent: options.transparent === true,
    webPreferences: { contextIsolation: true },
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') errors.push(event.message);
  });
  await win.loadFile(path.join(__dirname, '..', file));
  win.webContents.setZoomFactor(options.zoomFactor || 1);
  if (options.resetStorage !== false) {
    await win.webContents.executeJavaScript(`
      localStorage.removeItem('desktopTimerAlarms');
      localStorage.removeItem('desktopTimerLaps');
      localStorage.removeItem('desktopTimerCountdown');
      localStorage.removeItem('desktopTimerStopwatch');
      localStorage.setItem('zhiyu-theme', 'light');
    `);
  }
  if (options.skipWelcome) {
    await win.webContents.executeJavaScript(`localStorage.setItem('zhiyu-welcomed-v1', '1')`);
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.reload();
    await reloaded;
  }
  if (options.action) await win.webContents.executeJavaScript(options.action);
  await new Promise((resolve) => setTimeout(resolve, options.wait || 900));
  const metrics = await win.webContents.executeJavaScript(`({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    welcomeDisplay: document.getElementById('welcomeOverlay')?.style.display,
    settingsDisplay: getComputedStyle(document.getElementById('settingsOverlay') || document.body).display,
    settingsModalBounds: document.querySelector('.settings-modal')?.getBoundingClientRect().toJSON(),
    settingsModalOpacity: getComputedStyle(document.querySelector('.settings-modal') || document.body).opacity,
    settingsModalTransform: getComputedStyle(document.querySelector('.settings-modal') || document.body).transform,
    warningHidden: document.getElementById('warningPanel')?.classList.contains('is-hidden'),
    warningText: document.getElementById('warningMessage')?.textContent,
    tabOpacity: document.getElementById('countdown') ? getComputedStyle(document.getElementById('countdown')).opacity : null,
    petBounds: document.getElementById('petContainer')?.getBoundingClientRect().toJSON(),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    petControlsVisible: document.getElementById('petContainer')?.classList.contains('controls-visible'),
    petCloseOpacity: getComputedStyle(document.getElementById('petClose') || document.body).opacity,
    petClosePointerEvents: getComputedStyle(document.getElementById('petClose') || document.body).pointerEvents,
    petCloseStates: window.__petCloseStates || [],
    petDragging: document.getElementById('petContainer')?.classList.contains('dragging'),
    petClickedMain: window.__petClickedMain || 0,
    petRippleActive: document.getElementById('petImage')?.classList.contains('ripple'),
    petChatDisplay: getComputedStyle(document.getElementById('petChatPanel') || document.body).display,
    apiMoves: window.__apiMoves || [],
    petMouseModes: window.__petMouseModes || [],
    petStateTrace: window.__petStateTrace || [],
    petMotionCalls: window.__petMotionCalls || [],
    petImageFile: document.getElementById('petImg')?.src.split('/').pop() || '',
    petBoneVisible: getComputedStyle(document.getElementById('petBone') || document.body).display !== 'none',
    petBoneBounds: document.getElementById('boneCanvas')?.getBoundingClientRect().toJSON(),
    petFrontLegTransform: getComputedStyle(document.getElementById('fLeg') || document.body).transform,
    petStateLabelDisplay: getComputedStyle(document.getElementById('petStateLabel') || document.body).display,
    petRunSurvivedUnknown: window.__petRunSurvivedUnknown || false,
    petWorkSurvivedWindowState: window.__petWorkSurvivedWindowState || false,
    petActivityReleased: window.__petActivityReleased || false,
    petActivities: window.__petActivities || [],
    petFacingRight: document.getElementById('petContainer')?.classList.contains('facing-right') || false,
    miniInfoBounds: document.getElementById('miniInfo')?.getBoundingClientRect().toJSON(),
    miniInfoDisplay: getComputedStyle(document.getElementById('miniInfo') || document.body).display,
    miniInfoOpacity: getComputedStyle(document.getElementById('miniInfo') || document.body).opacity,
    petCloseBounds: document.getElementById('petClose')?.getBoundingClientRect().toJSON()
    ,functional: window.__functional || null
  })`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, output), image.toPNG());
  win.destroy();
  return { file, output, metrics, errors };
}

app.whenReady().then(async () => {
  const results = [
    await capture('index.html', 440, 800, 'main-ui.png', { skipWelcome: true }),
    await capture('index.html', 440, 800, 'timer-ui.png', {
      skipWelcome: true,
      action: `document.querySelector('[data-tab="timer"]').click()`,
    }),
    await capture('index.html', 440, 800, 'alarm-page-ui.png', {
      skipWelcome: true,
      action: `
        document.querySelector('[data-tab="alarm"]').click();
        document.getElementById('alarmTime').value = '08:30';
        document.getElementById('alarmLabel').value = '晨间提醒';
        document.getElementById('repeatDaily').checked = true;
        document.getElementById('addAlarmBtn').click();
      `,
    }),
    await capture('index.html', 440, 800, 'settings-ui.png', {
      skipWelcome: true,
      action: `document.getElementById('settingsBtn').click()`,
    }),
    await capture('index.html', 440, 800, 'settings-ringtone-ui.png', {
      skipWelcome: true,
      action: `
        document.getElementById('settingsBtn').click();
        document.querySelector('[data-stab="ringtone"]').click();
      `,
    }),
    await capture('index.html', 440, 800, 'settings-pet-ui.png', {
      skipWelcome: true,
      action: `
        document.getElementById('settingsBtn').click();
        document.querySelector('[data-stab="pet"]').click();
      `,
    }),
    await capture('index.html', 440, 800, 'settings-data-ui.png', {
      skipWelcome: true,
      action: `
        document.getElementById('settingsBtn').click();
        document.querySelector('[data-stab="data"]').click();
      `,
    }),
    await capture('index.html', 440, 800, 'functional-ui.png', {
      skipWelcome: true,
      action: `(async () => {
        const target = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        target.setMinutes(target.getMinutes() - target.getTimezoneOffset());
        document.getElementById('customDate').value = target.toISOString().slice(0, 16);
        document.getElementById('customLabel').value = 'UI test countdown';
        document.getElementById('startCountdownBtn').click();
        const countdownImmediate = document.getElementById('countdownDisplay').textContent.includes('天');
        const countdownPresetsRemoved = document.querySelectorAll('.preset-btn').length === 0;
        const countdownClearAvailable = !document.getElementById('clearCountdownBtn').classList.contains('is-hidden');
        document.getElementById('clearCountdownBtn').click();
        const countdownCleared =
          document.getElementById('countdownDisplay').textContent === '00:00:00' &&
          document.getElementById('countdownLabel').textContent === '设置倒计时';

        const petActivities = [];
        window.__petActivities = petActivities;
        window.api = {
          setPetActivity: async (activity) => { petActivities.push(activity); return activity; },
          setStopwatch: async () => true,
        };
        document.querySelector('[data-tab="timer"]').click();
        document.getElementById('startTimerBtn').click();
        await new Promise(resolve => setTimeout(resolve, 40));
        const timerStarted = document.getElementById('startTimerBtn').disabled;
        document.getElementById('pauseTimerBtn').click();
        const timerPaused = !document.getElementById('startTimerBtn').disabled;

        document.querySelector('[data-tab="alarm"]').click();
        document.getElementById('alarmTime').value = '08:30';
        document.getElementById('alarmLabel').value = 'UI test';
        document.getElementById('addAlarmBtn').click();
        const alarmAdded = document.querySelectorAll('.alarm-item').length === 1;
        document.querySelector('.edit-alarm').click();
        document.getElementById('alarmLabel').value = 'Edited alarm';
        document.getElementById('addAlarmBtn').click();
        const alarmEdited =
          document.querySelectorAll('.alarm-item').length === 1 &&
          document.querySelector('.alarm-label-text').textContent.includes('Edited alarm');

        document.getElementById('settingsBtn').click();
        const settingsOpened = document.getElementById('settingsOverlay').classList.contains('show');
        document.getElementById('themeToggle').click();
        const darkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
        document.getElementById('settingsCloseBtn').click();
        const settingsClosed = !document.getElementById('settingsOverlay').classList.contains('show');
        window.__functional = {
          countdownImmediate, countdownPresetsRemoved, countdownClearAvailable, countdownCleared,
          timerStarted, timerPaused,
          alarmAdded, alarmEdited, settingsOpened, darkTheme, settingsClosed
        };
      })()`,
      wait: 50,
    }),
    await capture('index.html', 440, 800, 'warning-data-ui.png', {
      skipWelcome: true,
      action: `(async () => {
        while (!window._initComplete) await new Promise(resolve => setTimeout(resolve, 20));
        window.dispatchEvent(new CustomEvent('app-warning', {
          detail: { type: 'data-restored', message: '数据文件损坏，已从备份恢复。' }
        }));
      })()`,
      wait: 80,
    }),
    await capture('index.html', 440, 800, 'warning-autostart-ui.png', {
      skipWelcome: true,
      action: `(async () => {
        while (!window._initComplete) await new Promise(resolve => setTimeout(resolve, 20));
        window.dispatchEvent(new CustomEvent('app-warning', {
          detail: { type: 'auto-start-failed', message: '开机自启设置失败：权限不足' }
        }));
      })()`,
      wait: 80,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-ui.png', { frame: false, transparent: true }),
    await capture('pet.html', PET_PANEL_WIDTH, PET_PANEL_HEIGHT, 'pet-chat-ui.png', {
      frame: false,
      transparent: true,
      action: `(async () => {
        await new Promise(resolve => setTimeout(resolve, 80));
        const panel = document.getElementById('petChatPanel');
        panel.style.animation = 'none';
        panel.style.opacity = '1';
        panel.classList.add('show');
        panel.getBoundingClientRect();
      })()`,
      wait: 400,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-next-alarm-ui.png', {
      frame: false,
      transparent: true,
      action: `
        document.getElementById('nextAlarmTime').textContent = '04:30 (11小时35分后)';
        document.getElementById('miniInfo').className = 'mini-info show';
      `,
      wait: 450,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-click-through-ui.png', {
      frame: false,
      transparent: true,
      action: `
        window.__petMouseModes = [];
        window.__petCloseStates = [];
        window.api = { setPetMouseEvents: (enabled) => window.__petMouseModes.push(enabled) };
        const pet = document.getElementById('petContainer');
        const close = document.getElementById('petClose');
        const snapshot = (label) => window.__petCloseStates.push({
          label,
          visible: pet.classList.contains('controls-visible'),
          pointerEvents: getComputedStyle(close).pointerEvents,
        });
        snapshot('initial');
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 150, bubbles: true }));
        snapshot('pet');
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 62, clientY: 180, bubbles: true }));
        snapshot('near-transparent');
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 4, clientY: 4, bubbles: true }));
        snapshot('corner');
      `,
      wait: 50,
    }),
    await capture('pet.html', Math.round(PET_WINDOW_WIDTH * 1.25), Math.round(PET_WINDOW_HEIGHT * 1.25), 'pet-hidpi-ui.png', {
      frame: false,
      transparent: true,
      zoomFactor: 1.25,
      wait: 120,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-drag-ui.png', {
      frame: false,
      transparent: true,
      action: `
        window.__apiMoves = [];
        window.api = { setWindowPos: (x, y) => window.__apiMoves.push([x, y]) };
        const pet = document.getElementById('petImage');
        pet.setPointerCapture = () => {};
        pet.hasPointerCapture = () => false;
        pet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, clientX: 100, clientY: 100, screenX: 100, screenY: 100, bubbles: true }));
        pet.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, buttons: 1, clientX: 130, clientY: 125, screenX: 130, screenY: 125, bubbles: true }));
        pet.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, button: 0, clientX: 130, clientY: 125, screenX: 130, screenY: 125, bubbles: true }));
      `,
      wait: 50,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-click-main-ui.png', {
      frame: false,
      transparent: true,
      action: `
        window.__petClickedMain = 0;
        window.api = {
          showMain: async () => { window.__petClickedMain += 1; },
          setPetMouseEvents: () => {},
        };
        const target = document.getElementById('petImage');
        target.setPointerCapture = () => {};
        target.hasPointerCapture = () => false;
        target.dispatchEvent(new PointerEvent('pointerdown', {
          pointerId: 8, button: 0, clientX: 140, clientY: 180, bubbles: true
        }));
        target.dispatchEvent(new PointerEvent('pointerup', {
          pointerId: 8, button: 0, clientX: 140, clientY: 180, bubbles: true
        }));
      `,
      wait: 350,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-alarm-ui.png', {
      frame: false,
      transparent: true,
      action: `triggerAlarmReaction({ label: '休息一下' })`,
      wait: 250,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-states-ui.png', {
      frame: false,
      transparent: true,
      action: `
        window.__petStateTrace = [];
        window.__petMotionCalls = [];
        let hitRightOnce = false;
        window.api = {
          movePetBy: async (dx, dy) => {
            window.__petMotionCalls.push([dx, dy]);
            if (dx > 0 && !hitRightOnce) {
              hitRightOnce = true;
              return { hitLeft: false, hitRight: true };
            }
            return { hitLeft: dx < 0, hitRight: false };
          },
        };
        const container = document.getElementById('petContainer');
        const label = document.getElementById('petStateLabel');
        ['idle', 'walk', 'sleep', 'work', 'music', 'celebrate', 'drag', 'chat', 'run'].forEach((state) => {
          setPetState(state);
          window.__petStateTrace.push({
            state,
            active: container.classList.contains('state-' + state),
            label: label.textContent,
          });
        });
        handleWindowState({ process: 'unknown.exe', idleMs: 0, locked: false });
        handleWindowState({ process: 'unknown.exe', idleMs: 5000, locked: false });
        window.__petRunSurvivedUnknown = container.classList.contains('state-run');
      `,
      wait: 520,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-activity-ui.png', {
      frame: false,
      transparent: true,
      action: `
        const container = document.getElementById('petContainer');
        applyExternalActivity({ state: 'work', source: 'stopwatch' });
        handleWindowState({ process: 'spotify.exe', idleMs: 0, locked: false });
        window.__petWorkSurvivedWindowState = container.classList.contains('state-work');
        applyExternalActivity({ state: 'idle', source: 'stopwatch-pause' });
        window.__petActivityReleased = container.classList.contains('state-idle');
      `,
      wait: 80,
    }),
  ];
  const petResults = results.filter((result) => result.file === 'pet.html');
  for (const result of petResults) {
    if (result.output === 'pet-hidpi-ui.png') {
      const surfaceWidthDiff = Math.abs(result.metrics.petBounds.width - result.metrics.clientWidth);
      const surfaceHeightDiff = Math.abs(result.metrics.petBounds.height - result.metrics.clientHeight);
      if (
        surfaceWidthDiff > 2 ||
        surfaceHeightDiff > 2 ||
        result.metrics.clientWidth < PET_WINDOW_WIDTH ||
        result.metrics.clientHeight < PET_WINDOW_HEIGHT
      ) {
        throw new Error(
          `Pet high-DPI surface does not match its viewport: surface=${result.metrics.petBounds.width}x${result.metrics.petBounds.height}, viewport=${result.metrics.clientWidth}x${result.metrics.clientHeight}`,
        );
      }
      continue;
    }
    const expectedWidth = result.output === 'pet-chat-ui.png' ? PET_PANEL_WIDTH : PET_WINDOW_WIDTH;
    const expectedHeight = result.output === 'pet-chat-ui.png' ? PET_PANEL_HEIGHT : PET_WINDOW_HEIGHT;
    const widthDiff = Math.abs(result.metrics.petBounds.width - expectedWidth);
    const heightDiff = Math.abs(result.metrics.petBounds.height - expectedHeight);
    if (widthDiff > 2 || heightDiff > 2) {
      throw new Error(
        `Pet surface escaped its fixed window contract: ${result.metrics.petBounds.width}x${result.metrics.petBounds.height}`,
      );
    }
    if (result.output !== 'pet-alarm-ui.png' && result.metrics.bodyBackground !== 'rgba(0, 0, 0, 0)') {
      throw new Error('Pet window background is not transparent');
    }
  }
  const dragResult = results.find((result) => result.metrics.apiMoves.length > 0);
  if (!dragResult || dragResult.metrics.apiMoves.length !== 1 || dragResult.metrics.petDragging) {
    throw new Error('Pet drag did not move once and release cleanly');
  }
  if (dragResult.metrics.apiMoves[0][1] <= 0) {
    throw new Error('Pet drag smoke test did not move the pet downward');
  }
  const stateResult = results.find((result) => result.output === 'pet-states-ui.png');
  const expectedStateLabels = {
    idle: '待机', walk: '慢走', run: '跑步', sleep: '睡觉', work: '工作',
    music: '听歌', celebrate: '闹钟庆祝', drag: '拖动中', chat: '对话',
  };
  if (!stateResult || stateResult.metrics.petStateTrace.length !== Object.keys(expectedStateLabels).length) {
    throw new Error('Pet state smoke test did not visit all states');
  }
  for (const entry of stateResult.metrics.petStateTrace) {
    if (!entry.active || entry.label !== expectedStateLabels[entry.state]) {
      throw new Error(`Pet state ${entry.state} was not rendered correctly`);
    }
  }
  const horizontalMoves = stateResult.metrics.petMotionCalls.map((call) => call[0]);
  if (!horizontalMoves.some((dx) => dx > 0) || !horizontalMoves.some((dx) => dx < 0)) {
    throw new Error('Pet run state did not move and reverse at the desktop edge');
  }
  const lastHorizontalMove = horizontalMoves.at(-1);
  if ((lastHorizontalMove > 0) !== stateResult.metrics.petFacingRight) {
    throw new Error('Pet visual direction does not match its desktop movement direction');
  }
  if (!stateResult.metrics.petBoneVisible) {
    throw new Error('Pet movement did not activate the 2D bone layer');
  }
  const boneBounds = stateResult.metrics.petBoneBounds;
  if (!boneBounds || boneBounds.width < 80 || boneBounds.height < 140 || boneBounds.bottom <= 0 || boneBounds.top >= PET_WINDOW_HEIGHT) {
    throw new Error(`Pet bone layer is outside the visible window: ${JSON.stringify(boneBounds)}`);
  }
  if (!stateResult.metrics.petFrontLegTransform || stateResult.metrics.petFrontLegTransform === 'none') {
    throw new Error('Pet front leg did not receive a bone rotation');
  }
  if (stateResult.metrics.petStateLabelDisplay !== 'none') {
    throw new Error('Pet state label should be hidden by default');
  }
  if (!stateResult.metrics.petRunSurvivedUnknown) {
    throw new Error('Pet run state was interrupted by an unchanged unknown window state');
  }
  const petActivityResult = results.find((result) => result.output === 'pet-activity-ui.png');
  if (!petActivityResult?.metrics.petWorkSurvivedWindowState || !petActivityResult.metrics.petActivityReleased) {
    throw new Error('Pet productivity activity did not retain and release its priority state');
  }
  const activityResult = results.find((result) => result.output === 'functional-ui.png');
  const activityStates = activityResult?.metrics.petActivities?.map((activity) => activity.state) || [];
  if (!activityStates.includes('work') || activityStates.at(-1) !== 'idle') {
    throw new Error(`Stopwatch did not publish work then idle pet activity: ${JSON.stringify(activityStates)}`);
  }
  const petClickResult = results.find((result) => result.output === 'pet-click-main-ui.png');
  if (!petClickResult || petClickResult.metrics.petClickedMain !== 1 || !petClickResult.metrics.petRippleActive) {
    throw new Error('Pet click did not request the main window and show feedback');
  }
  const nextAlarmResult = results.find((result) => result.output === 'pet-next-alarm-ui.png');
  const info = nextAlarmResult && nextAlarmResult.metrics.miniInfoBounds;
  const close = nextAlarmResult && nextAlarmResult.metrics.petCloseBounds;
  if (nextAlarmResult.metrics.miniInfoDisplay === 'none' || Number(nextAlarmResult.metrics.miniInfoOpacity) < 0.99) {
    throw new Error(`Pet next-alarm panel is not visible: ${JSON.stringify(nextAlarmResult.metrics)}`);
  }
  if (!info || info.left < 0 || info.right > PET_WINDOW_WIDTH || info.top < 0 || info.bottom > PET_WINDOW_HEIGHT) {
    throw new Error(`Pet next-alarm panel escaped the visible window: ${JSON.stringify(info)}`);
  }
  if (close && info.left < close.right && info.right > close.left && info.top < close.bottom && info.bottom > close.top) {
    throw new Error(`Pet next-alarm panel overlaps the close button: ${JSON.stringify({ info, close })}`);
  }
  const defaultPetResult = results.find((result) => result.output === 'pet-ui.png');
  if (
    !defaultPetResult ||
    defaultPetResult.metrics.petControlsVisible ||
    Number(defaultPetResult.metrics.petCloseOpacity) > 0.01 ||
    defaultPetResult.metrics.petClosePointerEvents !== 'none'
  ) {
    throw new Error('Pet close button should be hidden until the visible pet is hovered');
  }
  const chatPanelResult = results.find((result) => result.output === 'pet-chat-ui.png');
  if (!chatPanelResult || chatPanelResult.metrics.petChatDisplay !== 'flex') {
    throw new Error('Pet chat panel did not render in the expanded window');
  }
  const hitTestResult = results.find((result) => result.output === 'pet-click-through-ui.png');
  if (!hitTestResult || hitTestResult.metrics.petMouseModes.join(',') !== 'true,false') {
    throw new Error(`Pet click-through hit testing did not toggle transparent and interactive areas: ${JSON.stringify(hitTestResult && hitTestResult.metrics.petMouseModes)}`);
  }
  const closeStates = hitTestResult.metrics.petCloseStates;
  if (
    !closeStates ||
    closeStates.map((state) => state.visible).join(',') !== 'false,true,false,false' ||
    closeStates.map((state) => state.pointerEvents).join(',') !== 'none,auto,none,none'
  ) {
    throw new Error(`Pet close button visibility did not follow the visible hover region: ${JSON.stringify(closeStates)}`);
  }
  const functionalResult = results.find((result) => result.metrics.functional);
  if (!functionalResult || Object.values(functionalResult.metrics.functional).some((value) => value !== true)) {
    throw new Error('Main-window functional smoke test failed');
  }
  const dataWarning = results.find((result) => result.output === 'warning-data-ui.png');
  if (!dataWarning || dataWarning.metrics.warningHidden || !dataWarning.metrics.warningText.includes('备份恢复')) {
    throw new Error('Data recovery warning prompt did not render');
  }
  const autoStartWarning = results.find((result) => result.output === 'warning-autostart-ui.png');
  if (!autoStartWarning || autoStartWarning.metrics.warningHidden || !autoStartWarning.metrics.warningText.includes('开机自启设置失败')) {
    throw new Error('Auto-start failure warning prompt did not render');
  }
  const realErrors = results.flatMap((result) => result.errors).filter((message) =>
    !message.includes('Electron Security Warning') &&
    !message.includes("Applying inline style violates the following Content Security Policy directive")
  );
  if (realErrors.length) throw new Error(realErrors.join('\n'));
  console.log(JSON.stringify(results));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
