const port = process.argv[2] || '9225';

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
    const result = {
      secureContext: window.isSecureContext,
      mediaDevices: !!navigator.mediaDevices,
      userMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    };
    try {
      result.devices = (await navigator.mediaDevices.enumerateDevices()).map(device => ({
        kind: device.kind,
        label: device.label,
        deviceId: device.deviceId ? 'present' : ''
      }));
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      result.ok = true;
      result.tracks = stream.getVideoTracks().map(track => ({ label: track.label, readyState: track.readyState }));
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      result.ok = false;
      result.errorName = error && error.name;
      result.errorMessage = error && error.message;
    }
    return result;
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
  console.log(JSON.stringify(response.result.result.value, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
