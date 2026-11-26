// Chirp glasses app: wires the SDK (lens, mic, touch, ring) to the controller.
import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { ChirpDecoder } from './decoder';
import { Controller, type Input } from './controller';
import { httpApi } from './http';

// Builds call VITE_API_BASE. The dev server has none and uses same-origin /api, which vite proxies to :8787.
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const HAS_SERVER = Boolean(API_BASE) || import.meta.env.DEV;
const TEXT_ID = 1;
const TEXT_NAME = 'lens';
const $ = (id: string) => document.getElementById(id)!;

// Dev-only raw capture (simulator harness): ?capture=1 posts mic PCM to the dev server.
const CAPTURE = import.meta.env.DEV && new URLSearchParams(location.search).has('capture');
let capBuf: Uint8Array[] = [];
if (CAPTURE) {
  setInterval(() => {
    if (!capBuf.length) return;
    const body = new Blob(capBuf as BlobPart[]);
    capBuf = [];
    void fetch('/__capture', { method: 'POST', body });
  }, 1000);
}

async function main() {
  const bridge = await waitForEvenAppBridge();
  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        new TextContainerProperty({
          xPosition: 8,
          yPosition: 8,
          width: 560,
          height: 272,
          containerID: TEXT_ID,
          containerName: TEXT_NAME,
          content: 'Chirp\nstarting…',
          isEventCapture: 1,
        }),
      ],
    }),
  );
  if (created !== StartUpPageCreateResult.success) {
    $('phone-status').textContent = `Could not open the lens page (result ${created}).`;
    return;
  }
  const show = (content: string) => {
    $('phone-lens').textContent = content;
    return bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: TEXT_ID, containerName: TEXT_NAME, content }));
  };

  if (!HAS_SERVER) {
    await show('Chirp\nthis build has no server address\n\n2×tap: exit');
    return;
  }

  const decoder = new ChirpDecoder();
  try {
    await decoder.init();
  } catch (e) {
    await show('Chirp\nsound decoder failed to load\n\n2×tap: exit');
    $('phone-status').textContent = `Decoder failed: ${String(e)}`;
    return;
  }

  const api = httpApi(API_BASE);
  // The bot's name comes from the server, which reads it from its own Telegram token.
  const bot = await api.config!().then((r) => `@${r.bot}`).catch(() => 'the Chirp bot');
  // 'g2' on real glasses; the simulator reports no device. Sent with each hearing so a real-G2 decode is visible in /api/hearing.
  const model = await bridge.getDeviceInfo().then((d) => d?.model ?? 'none').catch(() => 'none');
  console.log(`[chirp] device model=${model}`);
  const c = new Controller({
    api,
    model,
    show,
    setMic: async (on, source) => {
      await bridge.audioControl(false);
      if (on) await bridge.audioControl(true, source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses);
      $('phone-status').textContent = on ? `Listening with the ${source} microphone.` : 'Paused.';
    },
    exit: () => bridge.shutDownPageContainer(1), // system exit dialog
    getItem: async (k) => (await bridge.getLocalStorage(k)) ?? '',
    setItem: (k, v) => bridge.setLocalStorage(k, v),
    log: (m) => console.log(m),
    botName: bot,
  });

  bridge.onEvenHubEvent(async (event) => {
    const audio = event.audioEvent;
    if (audio?.audioPcm) {
      if (c.recordNote(audio.audioPcm)) return; // a voice note is being recorded, not a chirp
      if (!c.listening) return;
      if (CAPTURE) capBuf.push(audio.audioPcm.slice());
      const got = decoder.push(audio.audioPcm);
      if (got) {
        $('heard-count').textContent = String(c.heardCount + 1);
        await c.onFrame(got.text.trim());
      }
      return;
    }
    if (import.meta.env.DEV) console.log(`[chirp] event ${JSON.stringify({ text: event.textEvent, sys: event.sysEvent, list: event.listEvent })}`);
    // A single press arrives with eventType 0, which the SDK normalises to undefined.
    const type = event.textEvent
      ? (event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT)
      : event.sysEvent
        ? (event.sysEvent.eventType ?? (event.sysEvent.eventSource !== undefined ? OsEventTypeList.CLICK_EVENT : undefined))
        : undefined;
    const map: Partial<Record<number, Input>> = {
      [OsEventTypeList.CLICK_EVENT]: 'tap',
      [OsEventTypeList.DOUBLE_CLICK_EVENT]: 'double',
      [OsEventTypeList.SCROLL_TOP_EVENT]: 'swipe',
      [OsEventTypeList.SCROLL_BOTTOM_EVENT]: 'swipe',
      [OsEventTypeList.LONG_PRESS_EVENT]: 'hold-start',
      [OsEventTypeList.LONG_PRESS_RELEASE_EVENT]: 'hold',
    };
    const input = type === undefined ? undefined : map[type];
    if (input) {
      if (import.meta.env.DEV) console.log(`[chirp] input ${input}`);
      await c.onInput(input);
    }
  });

  await c.start();
  setInterval(() => void c.tick(), 3000);
}

main().catch((e) => {
  const el = document.getElementById('phone-status');
  if (el) el.textContent = `Error: ${String(e)}`;
  console.error(e);
});
