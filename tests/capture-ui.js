const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const PET_WINDOW_WIDTH = 280;
const PET_WINDOW_HEIGHT = 340;

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
    warningHidden: document.getElementById('warningPanel')?.classList.contains('is-hidden'),
    warningText: document.getElementById('warningMessage')?.textContent,
    tabOpacity: document.getElementById('countdown') ? getComputedStyle(document.getElementById('countdown')).opacity : null,
    petBounds: document.getElementById('petContainer')?.getBoundingClientRect().toJSON(),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    petDragging: document.getElementById('petContainer')?.classList.contains('dragging'),
    apiMoves: window.__apiMoves || [],
    petMouseModes: window.__petMouseModes || []
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
    await capture('index.html', 440, 800, 'settings-ui.png', {
      skipWelcome: true,
      action: `document.getElementById('settingsBtn').click()`,
    }),
    await capture('index.html', 440, 800, 'functional-ui.png', {
      skipWelcome: true,
      action: `(async () => {
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

        document.getElementById('settingsBtn').click();
        const settingsOpened = document.getElementById('settingsOverlay').classList.contains('show');
        document.getElementById('themeToggle').click();
        const darkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
        document.getElementById('settingsCloseBtn').click();
        const settingsClosed = !document.getElementById('settingsOverlay').classList.contains('show');
        window.__functional = { timerStarted, timerPaused, alarmAdded, settingsOpened, darkTheme, settingsClosed };
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
        window.api = { setPetMouseEvents: (enabled) => window.__petMouseModes.push(enabled) };
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 180, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 4, clientY: 4, bubbles: true }));
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
        window.api = { movePetTo: (x, y) => window.__apiMoves.push([x, y]) };
        const pet = document.getElementById('petContainer');
        pet.setPointerCapture = () => {};
        pet.hasPointerCapture = () => false;
        pet.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, button: 0, screenX: 100, screenY: 100, bubbles: true }));
        pet.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, buttons: 1, screenX: 130, screenY: 125, bubbles: true }));
        pet.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, button: 0, screenX: 130, screenY: 125, bubbles: true }));
      `,
      wait: 50,
    }),
    await capture('pet.html', PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT, 'pet-alarm-ui.png', {
      frame: false,
      transparent: true,
      action: `triggerAlarmReaction({ label: '休息一下' })`,
      wait: 250,
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
    const widthDiff = Math.abs(result.metrics.petBounds.width - PET_WINDOW_WIDTH);
    const heightDiff = Math.abs(result.metrics.petBounds.height - PET_WINDOW_HEIGHT);
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
  const hitTestResult = results.find((result) => result.output === 'pet-click-through-ui.png');
  if (!hitTestResult || hitTestResult.metrics.petMouseModes.join(',') !== 'true,false') {
    throw new Error('Pet click-through hit testing did not toggle transparent and interactive areas');
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
    !message.includes('Electron Security Warning')
  );
  if (realErrors.length) throw new Error(realErrors.join('\n'));
  console.log(JSON.stringify(results));
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
