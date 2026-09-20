const port = process.argv[2] || '9223';

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
    let probes = [];
    try {
      const mediaPipeBase = new URL('assets/mediapipe/', location.href).href.replace(/[/]$/, '');
      const modelUrl = new URL('assets/mediapipe/face_landmarker.task', location.href).href;
      probes = await Promise.all([
        mediaPipeBase + '/vision_wasm_internal.js',
        mediaPipeBase + '/vision_wasm_internal.wasm',
        modelUrl
      ].map(async (url) => {
        try {
          const response = await fetch(url);
          return { url, ok: response.ok, status: response.status, size: (await response.arrayBuffer()).byteLength };
        } catch (error) {
          return { url, ok: false, error: String(error) };
        }
      }));
      const fileset = await Vision.FilesetResolver.forVisionTasks(mediaPipeBase);
      const landmarker = await Vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: modelUrl,
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true
      });
      landmarker.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error), stack: error && error.stack, probes };
    }
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
  console.log('MediaPipe Face Landmarker initialized successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
