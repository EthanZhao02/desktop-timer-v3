const port = process.argv[2] || '9226';

async function main() {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = tabs.find((tab) => tab.type === 'page' && tab.title === '智域计时');
  if (!page) throw new Error('智域计时页面未找到');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  const expression = `(async function () {
    const ringtone = await window.api.getRingtone();
    if (!ringtone || !ringtone.src) return { ok: false, error: 'no-ringtone' };
    const audio = new Audio(ringtone.src);
    audio.preload = 'metadata';
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'timeout', src: ringtone.src }), 8000);
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve({ ok: true, src: ringtone.src, duration: audio.duration });
      };
      audio.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, error: audio.error && audio.error.message, code: audio.error && audio.error.code, src: ringtone.src });
      };
      audio.load();
    });
  })()`;

  const response = await new Promise((resolve) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) resolve(message);
    };
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.close();

  const value = response.result && response.result.result && response.result.result.value;
  if (!value || !value.ok) throw new Error(value ? JSON.stringify(value) : JSON.stringify(response));
  console.log(`Ringtone loaded successfully (${value.duration.toFixed(2)}s): ${value.src}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
