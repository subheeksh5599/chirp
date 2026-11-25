// Chirp glasses app, phase 0: listen, decode, show what was heard on the lens.
import {
  AudioInputSource,
  OsEventTypeList,
  CreateStartUpPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { ChirpDecoder } from './decoder';

const TEXT_ID = 1;
const TEXT_NAME = 'lens';

const $ = (id: string) => document.getElementById(id)!;

type Source = 'glasses' | 'phone';

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

  const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
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
  }));
  if (created !== StartUpPageCreateResult.success) {
    $('phone-status').textContent = `Could not open the lens page (result ${created}).`;
    return;
  }

  const show = (content: string) =>
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: TEXT_ID, containerName: TEXT_NAME, content }),
    );

  const decoder = new ChirpDecoder();
  try {
    await decoder.init();
  } catch (e) {
    await show('Chirp\ndecoder failed to load\ndouble-tap to exit');
    $('phone-status').textContent = `Decoder failed: ${String(e)}`;
    return;
  }

  let source: Source = ((await bridge.getLocalStorage('mic-source')) as Source) || 'glasses';
  let listening = false;
  let heard = 0;
  let last = '';

  const idleScreen = () =>
    show(
      listening
        ? `Chirp · listening (${source} mic)\n${last ? `last: ${last}` : 'waiting for a chirp…'}\nhold: pause · swipe: switch mic`
        : `Chirp · paused\n${last ? `last: ${last}` : ''}\nhold: resume`,
    );

  const startMic = async () => {
    await bridge.audioControl(true, source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses);
    listening = true;
    $('phone-status').textContent = `Listening with the ${source} microphone.`;
    console.log(`[chirp] ready source=${source}`);
    await idleScreen();
  };
  const stopMic = async () => {
    await bridge.audioControl(false);
    listening = false;
    $('phone-status').textContent = 'Paused.';
    await idleScreen();
  };

  bridge.onEvenHubEvent(async (event) => {
    const audio = event.audioEvent;
    if (audio?.audioPcm && listening) {
      if (CAPTURE) capBuf.push(audio.audioPcm.slice());
      const got = decoder.push(audio.audioPcm);
      if (decoder.chunks % 50 === 0) console.log(`[chirp] audio chunks=${decoder.chunks} bytes=${audio.audioPcm.byteLength} peak=${decoder.peak.toFixed(3)}`);
      if (got) {
        heard++;
        last = got.text;
        console.log(`[chirp] heard ${got.text}`);
        $('heard-count').textContent = String(heard);
        const li = document.createElement('li');
        li.textContent = `${new Date(got.at).toLocaleTimeString()} · ${got.text}`;
        $('heard-list').prepend(li);
        await show(`Heard\n${got.text}\n${new Date(got.at).toLocaleTimeString()} · #${heard}`);
      }
      return;
    }

    const type = event.textEvent?.eventType ?? event.sysEvent?.eventType;
    if (event.textEvent || event.sysEvent) {
      switch (type) {
        case OsEventTypeList.DOUBLE_CLICK_EVENT:
          await bridge.audioControl(false);
          await bridge.shutDownPageContainer(1); // system exit dialog
          break;
        case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
          if (listening) await stopMic();
          else await startMic();
          break;
        case OsEventTypeList.SCROLL_TOP_EVENT:
        case OsEventTypeList.SCROLL_BOTTOM_EVENT:
          source = source === 'glasses' ? 'phone' : 'glasses';
          await bridge.setLocalStorage('mic-source', source);
          if (listening) {
            await bridge.audioControl(false);
            await startMic();
          } else await idleScreen();
          break;
        case OsEventTypeList.CLICK_EVENT:
        case undefined:
          await idleScreen();
          break;
      }
    }
  });

  await startMic();
}

main().catch((e) => {
  const el = document.getElementById('phone-status');
  if (el) el.textContent = `Error: ${String(e)}`;
});
