// Boot.

import * as ui from './ui.js';
import * as player from './player.js';
import * as speech from './speech.js';
import * as store from './store.js';
import * as lib from './library.js';
import * as notify from './notify.js';
import * as admob from './ads-admob.js';

async function boot() {
  ui.applyTheme();
  ui.bind();

  // Restore the last position first so the play button is live as early as
  // possible — the whole promise of the app is "open it and press play".
  await player.init();
  ui.setView('listen');
  ui.renderNow();

  player.bindMediaKeys();

  // Voices arrive late on most browsers; pick a sensible default once they do.
  await speech.ready();
  ui.renderNow();

  // Chrome publishes its better network voices in a later event. Re-render so
  // the picker and the settings row reflect what is actually available now.
  speech.onVoicesChanged(() => ui.renderNow());

  // Arm the daily verse, and show it if today's time already passed.
  notify.catchUp();

  // Deliberately last, and deliberately not awaited earlier: the banner is
  // the least important thing on screen, and nothing about starting the
  // reading should wait on an ad network. No-ops on the web.
  admob.start();

  if (!speech.supported) {
    ui.toast('This browser cannot read text aloud. Try Chrome, Edge or Safari.');
  }
}

boot();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  });
}
