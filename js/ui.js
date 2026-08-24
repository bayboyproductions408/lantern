// All rendering and event wiring.

import * as player from './player.js';
import * as store from './store.js';
import * as lib from './library.js';
import * as speech from './speech.js';
import * as plans from './plans.js';
import * as money from './monetize.js';
import * as notify from './notify.js';
import * as share from './share.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/** Small DOM builder — keeps scripture text on textContent, never innerHTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/* ── Ad slot bookkeeping ──────────────────────────────────────── */

// Slots inside re-rendered views must be torn down explicitly, or their refresh
// timers keep running against elements that are no longer on the page.
const mountedSlots = new Set();

function mountAd(el, placement) {
  money.mountAdSlot(el, placement, handleAdAction);
  mountedSlots.add(el);
}

function unmountAdsIn(container) {
  for (const el of [...mountedSlots]) {
    if (container.contains(el)) {
      money.destroyAdSlot(el);
      mountedSlots.delete(el);
    }
  }
}

function adSlot() {
  return el('div', { class: 'ad-slot' });
}

/* ── Toast ────────────────────────────────────────────────────── */

let toastTimer = null;
export function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ── Bottom sheet ─────────────────────────────────────────────── */

export function openSheet(title, subtitle, build) {
  const sheet = $('#sheet');
  sheet.innerHTML = '';
  sheet.append(el('div', { class: 'sheet-grip' }));
  if (title) sheet.append(el('h3', { text: title }));
  if (subtitle) sheet.append(el('p', { text: subtitle }));
  build(sheet);
  sheet.hidden = false;
  $('#scrim').hidden = false;
}

export function closeSheet() {
  $('#sheet').hidden = true;
  $('#scrim').hidden = true;
}

/* ── View switching ───────────────────────────────────────────── */

let currentView = 'listen';

export function setView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.toggle('is-on', v.dataset.view === name));
  $$('.tabbar button').forEach(b => b.classList.toggle('is-on', b.dataset.nav === name));
  $('#mini').hidden = name === 'listen' || !store.get().hasListened;
  window.scrollTo({ top: 0 });

  if (name === 'library') renderLibrary();
  if (name === 'plans') renderPlans();
  if (name === 'give' && money.donationsAvailable()) renderGive();
  if (name === 'settings') renderSettings();
}

/* ── Now playing ──────────────────────────────────────────────── */

let lastRenderedChapter = '';

export function renderNow() {
  const c = player.current();
  const t = lib.TRANSLATIONS[c.translation];

  $('#nowRef').textContent = c.ref || '—';
  $('#nowSub').textContent = t ? t.name : '';
  $('#nowKicker').textContent = player.isPlaying()
    ? 'Now playing'
    : store.get().hasListened ? 'Continue listening' : 'Start listening';

  $('#translationChip').textContent = t ? t.abbr : '';
  $('#speedBtn').textContent = `${store.get().rate.toFixed(1)}×`;
  $('#toneBtn').textContent = speech.tone(store.get().tone).label;

  const sleep = player.sleepStatus();
  const note = $('#sleepNote');
  note.hidden = !sleep;
  note.textContent = sleep ? sleep.label : '';
  $('#sleepBtn').classList.toggle('is-on', Boolean(sleep));

  const marked = store.hasBookmark(c.book, c.chapter, c.verse);
  $('#bookmarkBtn').classList.toggle('is-on', marked);
  $('#bookmarkBtn').textContent = marked ? 'Bookmarked' : 'Bookmark';

  $('#miniRef').textContent = c.ref;
  $('#miniVerse').textContent = `verse ${c.verse + 1}`;
  $('#mini').hidden = currentView === 'listen' || !store.get().hasListened;

  // Only remember the chapter once there is something to show. A render that
  // lands before the chapter has loaded — switching translation kicks off an
  // async load, for instance — must not claim the key, or the real update that
  // follows would be skipped as already drawn and the reader would stay empty.
  const key = `${c.translation}/${c.book}/${c.chapter}`;
  if (key !== lastRenderedChapter && c.verses.length) {
    lastRenderedChapter = key;
    renderReader(c);
  }
  highlightVerse(c.verse);
}

function renderReader(c) {
  const reader = $('#reader');
  unmountAdsIn(reader);
  reader.innerHTML = '';
  if (!c.verses.length) return;

  c.verses.forEach((text, i) => {
    reader.append(
      el('button', {
        class: 'verse',
        'data-verse': i,
        onclick: () => player.goTo(c.book, c.chapter, i, { play: true }),
      }, el('span', { class: 'vn', text: String(i + 1) }), text)
    );
  });

  // A dedication belongs above the reading it was given for.
  const dedication = money.dedicationFor(c.book, c.chapter);
  if (dedication) {
    reader.prepend(
      el('div', { class: 'card', style: 'margin-bottom:18px' },
        el('p', { class: 'ad-label', text: 'This reading is dedicated' }),
        el('h3', { text: dedication.name }),
        dedication.message ? el('p', { text: dedication.message }) : null
      )
    );
  }

  reader.append(el('p', { class: 'chapter-end', text: 'End of chapter — the next one follows automatically.' }));

  // Sits after the reading, never inside it.
  const slot = adSlot();
  reader.append(slot);
  mountAd(slot, money.PLACEMENTS.chapterEnd);
}

let lastScrollByUser = 0;
window.addEventListener('scroll', () => { lastScrollByUser = Date.now(); }, { passive: true });

function highlightVerse(index) {
  const reader = $('#reader');
  const active = reader.querySelector('.verse.is-active');
  if (active) active.classList.remove('is-active');

  const node = reader.querySelector(`.verse[data-verse="${index}"]`);
  if (!node) return;
  node.classList.add('is-active');

  // Follow along while playing, but yield if the reader is scrolling by hand.
  if (!player.isPlaying() || currentView !== 'listen') return;
  if (Date.now() - lastScrollByUser < 4000) return;

  const rect = node.getBoundingClientRect();
  const margin = 140;
  if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* ── Library ──────────────────────────────────────────────────── */

let testament = 'OT';

async function renderLibrary() {
  const host = $('#bookList');
  const index = await lib.loadIndex(store.get().translation);
  unmountAdsIn(host);
  host.innerHTML = '';

  const books = index.filter(b => b.testament === testament);
  const genres = [...new Set(books.map(b => b.genre))];

  genres.forEach((genre, gi) => {
    host.append(el('h3', { class: 'genre-head', text: genre }));
    const grid = el('div', { class: 'book-grid' });

    for (const book of books.filter(b => b.genre === genre)) {
      const readCount = store.get().read[book.slug]?.length ?? 0;
      grid.append(
        el('button', { class: 'book-btn', onclick: () => openChapterPicker(book) },
          el('b', { text: book.name }),
          el('small', {
            text: readCount
              ? `${readCount} of ${book.chapters} heard`
              : `${book.chapters} ${book.chapters === 1 ? 'chapter' : 'chapters'} · ${lib.formatDuration(lib.secondsFor(book.words, store.get().rate))}`,
          })
        )
      );
    }
    host.append(grid);

    // One slot, after the first genre group, so it is seen without interrupting.
    if (gi === 0) {
      const slot = adSlot();
      host.append(slot);
      mountAd(slot, money.PLACEMENTS.library);
    }
  });
}

function openChapterPicker(book) {
  openSheet(book.name, `${book.chapters} chapters · ${lib.formatDuration(lib.secondsFor(book.words, store.get().rate))} of listening`, sheet => {
    const grid = el('div', { class: 'chapter-grid' });
    for (let c = 1; c <= book.chapters; c++) {
      grid.append(
        el('button', {
          class: `chapter-btn${store.isChapterRead(book.slug, c) ? ' is-read' : ''}`,
          text: String(c),
          onclick: () => {
            closeSheet();
            setView('listen');
            player.goTo(book.slug, c, 0, { play: true });
          },
        })
      );
    }
    sheet.append(grid);
  });
}

/* ── Plans ────────────────────────────────────────────────────── */

async function renderPlans() {
  const activeHost = $('#planActive');
  const listHost = $('#planList');
  activeHost.innerHTML = '';
  listHost.innerHTML = '';

  const state = store.get();
  const active = plans.activePlan();

  activeHost.append(
    el('div', { class: 'streak' },
      el('div', {}, el('b', { text: String(state.streak.count) }), el('small', { text: 'day streak' })),
      el('div', {}, el('b', { text: String(store.chaptersReadCount()) }), el('small', { text: 'chapters heard' })),
      el('div', {}, el('b', { text: lib.formatDuration(state.stats.seconds) }), el('small', { text: 'listened' }))
    )
  );

  if (active?.meta) {
    const days = await plans.planDays(active.id, state.translation);
    const day = days[active.day - 1] || [];
    const pct = Math.round((active.done.length / active.meta.days) * 100);

    activeHost.append(
      el('div', { class: 'card plan-active' },
        el('div', { class: 'card-row' },
          el('div', {},
            el('h3', { text: active.meta.title }),
            el('p', { text: `Day ${active.day} of ${active.meta.days} · ${plans.dayLabel(day)}` })
          )
        ),
        el('div', { class: 'bar' }, el('i', { style: `width:${pct}%` })),
        el('div', { class: 'card-row', style: 'margin-top:14px' },
          el('button', {
            class: 'btn',
            text: `Listen — about ${plans.dayMinutes(day, state.rate)} min`,
            onclick: () => playPlanDay(active, day),
          }),
          el('button', { class: 'btn ghost', text: 'Leave plan', onclick: () => { plans.stopPlan(); renderPlans(); } })
        )
      )
    );
  }

  for (const plan of plans.PLANS) {
    const isActive = active?.id === plan.id;
    listHost.append(
      el('button', { class: 'card', onclick: () => choosePlan(plan, isActive) },
        el('div', { class: 'card-row' },
          el('div', {},
            el('h3', { text: plan.title }),
            el('p', { text: `${plan.subtitle} · ${plan.days} days` })
          ),
          isActive ? el('span', { class: 'lock', text: 'Active' }) : null
        )
      )
    );
  }
}

function choosePlan(plan, isActive) {
  if (isActive) return;
  plans.startPlan(plan.id);
  toast(`Started “${plan.title}”`);
  renderPlans();
}

/**
 * A plan day can span several chapters. Playback starts at the first and the
 * player's own auto-advance carries through the rest.
 */
function playPlanDay(active, day) {
  if (!day.length) return;
  plans.completeDay(active.day);
  setView('listen');
  player.goTo(day[0].slug, day[0].chapter, 0, { play: true });
}

/* ── Search ───────────────────────────────────────────────────── */

let searching = false;

async function runSearch(event) {
  event.preventDefault();
  if (searching) return;

  const query = $('#searchInput').value.trim();
  const status = $('#searchStatus');
  const results = $('#searchResults');
  unmountAdsIn(results);
  results.innerHTML = '';

  if (query.length < 2) {
    status.textContent = 'Type at least two characters.';
    return;
  }

  searching = true;
  status.textContent = 'Preparing the text…';

  try {
    const found = await lib.search(store.get().translation, query, (done, total) => {
      status.textContent = done < total ? `Preparing the text… ${Math.round((done / total) * 100)}%` : 'Searching…';
    });

    status.textContent = found.length
      ? `${found.length}${found.length >= 200 ? '+' : ''} ${found.length === 1 ? 'verse' : 'verses'} found`
      : `Nothing found for “${query}”.`;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    found.forEach((r, i) => {
      results.append(
        el('button', {
          class: 'result',
          onclick: () => { setView('listen'); player.goTo(r.slug, r.chapter, r.verse, { play: true }); },
        },
          el('b', { text: `${r.name} ${r.chapter}:${r.verse + 1}` }),
          highlighted(r.text, terms)
        )
      );
      // A single native slot partway down the results.
      if (i === 4) {
        const slot = adSlot();
        results.append(slot);
        mountAd(slot, money.PLACEMENTS.search);
      }
    });
  } catch (err) {
    status.textContent = `Search failed: ${err.message}`;
  } finally {
    searching = false;
  }
}

/** Builds the snippet as real nodes so verse text is never parsed as HTML. */
function highlighted(text, terms) {
  const span = el('span');
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > last) span.append(text.slice(last, match.index));
    span.append(el('mark', { text: match[0] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) span.append(text.slice(last));
  return span;
}

/* ── Settings ─────────────────────────────────────────────────── */

function row(label, sub, right, onclick) {
  return el(onclick ? 'button' : 'div', { class: 'row', ...(onclick ? { onclick } : {}) },
    el('div', {}, el('b', { text: label }), sub ? el('small', { text: sub }) : null),
    right
  );
}

function group(title, ...rows) {
  return el('div', { class: 'set-group' }, el('h3', { text: title }), ...rows);
}

function toggleSwitch(isOn) {
  return el('span', { class: `switch${isOn ? ' is-on' : ''}` });
}

function renderSettings() {
  const host = $('#settingsBody');
  const state = store.get();
  host.innerHTML = '';

  host.append(renderSupportCard());

  const voice = activeVoice();

  host.append(
    group('Listening',
      row('Translation', lib.TRANSLATIONS[state.translation].name, el('span', { class: 'val', text: lib.TRANSLATIONS[state.translation].abbr }), openTranslationSheet),
      row('Narrator voice', voice ? voice.name : 'System default', el('span', { class: 'val', text: voice ? QUALITY_LABEL[voice.quality] : '' }), openVoiceSheet),
      row('Reading tone', speech.tone(state.tone).note, el('span', { class: 'val', text: speech.tone(state.tone).label }), openToneSheet),
      row('Speed', 'How fast the reading is spoken', el('span', { class: 'val', text: `${state.rate.toFixed(1)}×` }), openSpeedSheet),
      row('Keep playing', 'Roll into the next chapter automatically', toggleSwitch(state.autoAdvance), () => {
        store.set({ autoAdvance: !store.get().autoAdvance });
        renderSettings();
      })
    )
  );

  const offlineDone = state.offline.includes(state.translation);
  host.append(
    group('Library',
      row('Bookmarks', `${state.bookmarks.length} saved`, el('span', { class: 'val', text: 'View' }), openBookmarks),
      row('Offline listening', offlineDone ? 'This translation is saved on your device' : 'Save the whole Bible for flights and dead zones',
        el('span', { class: 'val', text: offlineDone ? 'Saved' : 'Download' }), startDownload),
      row('Daily verse', reminderSummary(), el('span', { class: 'val', text: state.reminder.enabled ? 'On' : 'Off' }), openReminderSheet),
      row('Appearance', 'Dark suits late-night listening', el('span', { class: 'val', text: state.theme === 'dark' ? 'Dark' : 'Light' }), () => {
        store.set({ theme: state.theme === 'dark' ? 'light' : 'dark' });
        applyTheme();
        renderSettings();
      })
    )
  );

  host.append(
    group('Support Lantern',
      row('Watch a short video', 'The single best way to help, and it takes a minute', el('span', { class: 'val', text: 'Watch' }), watchRewarded),
      money.donationsAvailable() ? row('Leave a tip', money.totalTipped() ? `Thank you — $${money.totalTipped().toFixed(2)} given so far` : 'Entirely optional, and unlocks nothing', el('span', { class: 'val', text: 'Give' }), () => setView('give')) : null
    )
  );

  host.append(
    group('About',
      row('Everything is free', 'No subscription, no account, no locked chapters. Ads and gifts pay for it.', el('span', { class: 'val', text: 'Always' })),
      row('Texts', 'King James Version (1611) and the Bible in Basic English — both public domain', el('span', { class: 'val', text: 'PD' })),
      row('Speech', speech.supported ? 'Read aloud by your device, so it works offline' : 'This browser cannot speak text aloud', el('span', { class: 'val', text: speech.supported ? 'Ready' : 'Unavailable' })),
      row('Reset app', 'Clears progress, bookmarks and listening history', el('span', { class: 'val', text: 'Reset' }), () => {
        openSheet('Reset everything?', 'Your position, streak, bookmarks and history will be erased.', sheet => {
          sheet.append(
            el('button', { class: 'btn wide', text: 'Yes, reset', onclick: () => { store.reset(); closeSheet(); location.reload(); } }),
            el('button', { class: 'btn ghost wide', style: 'margin-top:8px', text: 'Cancel', onclick: closeSheet })
          );
        });
      })
    )
  );

  if (money.isHouseOnly()) {
    host.append(el('p', { class: 'muted', text: `Ad network: ${money.networkLabel()}. Gifts are simulated in this build and no payment is taken.` }));
  }
}

/** Turns ad-watching into something the listener can feel good about. */
function renderSupportCard() {
  const { impressions, rewarded } = money.adStats();
  const given = money.totalTipped();

  return el('div', { class: 'promo' },
    el('h3', { text: 'Free for everyone, always' }),
    el('p', { text: 'Every verse, every voice, every plan — no subscription and no account. Advertising keeps it that way, so nobody has to pay to hear the Bible.' }),
    el('div', { class: 'streak', style: 'margin-top:0' },
      el('div', {}, el('b', { text: String(impressions) }), el('small', { text: 'ads seen' })),
      el('div', {}, el('b', { text: String(rewarded) }), el('small', { text: 'videos watched' })),
      el('div', {}, el('b', { text: `$${given.toFixed(0)}` }), el('small', { text: 'given' }))
    )
  );
}

/* ── Sheets ───────────────────────────────────────────────────── */

function openTranslationSheet() {
  openSheet('Translation', 'Both texts are public domain, so they are bundled in full.', sheet => {
    const list = el('div', { class: 'opt-list' });
    for (const t of Object.values(lib.TRANSLATIONS)) {
      list.append(
        el('button', {
          class: `opt${store.get().translation === t.id ? ' is-on' : ''}`,
          onclick: () => { player.setTranslation(t.id); closeSheet(); renderNow(); renderSettings(); },
        },
          el('span', {}, el('b', { text: t.name }), el('small', { text: t.note })),
          el('span', { text: t.abbr })
        )
      );
    }
    sheet.append(list);
  });
}

function formatTime(hour, minute) {
  const suffix = hour < 12 ? 'am' : 'pm';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, '0')}${suffix}`;
}

function reminderSummary() {
  const r = store.get().reminder;
  if (!notify.supported()) return 'This browser cannot show notifications';
  if (!r.enabled) return 'One passage a day, at a time you choose';
  return `Every day at ${formatTime(r.hour, r.minute)}`;
}

function openReminderSheet() {
  const r = store.get().reminder;
  openSheet('Daily verse', 'One passage a day. Never a nag about days missed — that is not what this is for.', sheet => {
    if (!notify.supported()) {
      sheet.append(el('p', { class: 'muted', text: 'This browser does not support notifications.' }));
      return;
    }

    if (r.enabled) {
      sheet.append(el('button', {
        class: 'btn ghost wide', style: 'margin-bottom:12px', text: 'Turn the daily verse off',
        onclick: () => { notify.disable(); closeSheet(); renderSettings(); toast('Daily verse turned off.'); },
      }));
    }

    sheet.append(el('p', { class: 'ad-label', text: r.enabled ? 'Change the time' : 'Send it at' }));
    const list = el('div', { class: 'opt-list' });
    for (const hour of [6, 7, 8, 12, 18, 21]) {
      list.append(el('button', {
        class: `opt${r.enabled && r.hour === hour ? ' is-on' : ''}`,
        text: formatTime(hour, 0),
        onclick: async () => {
          try {
            if (store.get().reminder.enabled) notify.setTime(hour, 0);
            else await notify.enable(hour, 0);
            closeSheet();
            renderSettings();
            toast(`Daily verse set for ${formatTime(hour, 0)}.`);
          } catch (err) {
            toast(err.message);
          }
        },
      }));
    }
    sheet.append(list);

    sheet.append(el('p', { class: 'muted', style: 'margin-top:14px',
      text: 'While Lantern is only a website, reminders arrive when the app is open at that time, plus a catch-up next time you open it. Installing it to your home screen makes them far more reliable.' }));
  });
}

const QUALITY_LABEL = { neural: 'Lifelike', enhanced: 'Better', standard: 'Basic' };

/** The voice currently chosen for the language being read. */
function activeVoice() {
  const lang = lib.langOf(store.get().translation);
  const uri = store.get().voiceByLang[lang];
  return (uri ? speech.findVoice(uri) : null) || speech.bestVoice(lang);
}

function openVoiceSheet() {
  const lang = lib.langOf(store.get().translation);
  const all = speech.voices(lang);
  const current = activeVoice();

  const subtitle = all.length
    ? 'Listed best first. Lifelike voices sound close to a person reading.'
    : `No ${lang === 'es' ? 'Spanish' : 'English'} voices are installed on this device.`;

  openSheet('Narrator voice', subtitle, sheet => {
    const list = el('div', { class: 'opt-list' });
    for (const v of all) {
      list.append(
        el('button', {
          class: `opt${current?.uri === v.uri ? ' is-on' : ''}`,
          onclick: () => { player.setVoice(v.uri); closeSheet(); renderNow(); renderSettings(); },
        },
          el('span', {}, el('b', { text: v.name }), el('small', { text: v.lang })),
          el('span', { class: 'val', text: QUALITY_LABEL[v.quality] })
        )
      );
    }
    sheet.append(list);

    if (!all.length) {
      sheet.append(el('p', { class: 'muted', style: 'margin-top:14px',
        text: 'Add one in your system speech settings, then reopen Lantern. Until then this translation cannot be read aloud.' }));
    } else if (speech.onlyBasicVoices(lang)) {
      // Windows ships only basic voices to Chrome. Edge exposes Microsoft's
      // "Natural" neural voices, which are a different class of quality.
      sheet.append(el('p', { class: 'muted', style: 'margin-top:14px',
        text: 'Only basic system voices were found. For a much more natural reading, try opening Lantern in Microsoft Edge, which offers Microsoft “Natural” voices, or install additional voices in your system speech settings.' }));
    }
  });
}

function openToneSheet() {
  openSheet('Reading tone', 'Sets the pacing, the pitch and how long the reader pauses between verses.', sheet => {
    const list = el('div', { class: 'opt-list' });
    for (const t of Object.values(speech.TONES)) {
      list.append(
        el('button', {
          class: `opt${store.get().tone === t.id ? ' is-on' : ''}`,
          onclick: () => { player.setTone(t.id); closeSheet(); renderNow(); renderSettings(); },
        },
          el('span', {}, el('b', { text: t.label }), el('small', { text: t.note }))
        )
      );
    }
    sheet.append(list);
  });
}

function openSpeedSheet() {
  openSheet('Reading speed', null, sheet => {
    const list = el('div', { class: 'opt-list' });
    for (const rate of [0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2]) {
      list.append(
        el('button', {
          class: `opt${Math.abs(store.get().rate - rate) < 0.01 ? ' is-on' : ''}`,
          onclick: () => { player.setRate(rate); closeSheet(); renderNow(); },
        },
          `${rate.toFixed(2).replace(/0$/, '')}×`,
          rate === 1 ? el('span', { class: 'val', text: 'Normal' }) : null
        )
      );
    }
    sheet.append(list);
  });
}

function openSleepSheet() {
  openSheet('Sleep timer', 'Playback stops on its own — handy for falling asleep to a reading.', sheet => {
    const list = el('div', { class: 'opt-list' });

    list.append(el('button', {
      class: 'opt', onclick: () => { player.setSleep('chapter'); closeSheet(); renderNow(); },
    }, 'At the end of this chapter'));

    for (const mins of [10, 15, 30, 45, 60, 90, 120]) {
      list.append(el('button', {
        class: 'opt', onclick: () => { player.setSleep(mins); closeSheet(); renderNow(); },
      }, `${mins} minutes`));
    }

    if (player.sleepStatus()) {
      list.append(el('button', {
        class: 'opt', onclick: () => { player.clearSleep(); closeSheet(); renderNow(); },
      }, 'Turn the timer off'));
    }
    sheet.append(list);
  });
}

function openBookmarks() {
  const marks = store.get().bookmarks;
  openSheet('Bookmarks', marks.length ? null : 'Tap Bookmark while listening to save a verse here.', sheet => {
    const list = el('div', { class: 'results' });
    for (const b of marks) {
      list.append(
        el('button', {
          class: 'result',
          onclick: () => { closeSheet(); setView('listen'); player.goTo(b.book, b.chapter, b.verse, { play: false }); },
        },
          el('b', { text: b.ref }),
          el('span', { text: b.text.length > 150 ? `${b.text.slice(0, 150)}…` : b.text })
        )
      );
    }
    sheet.append(list);
  });
}

/* ── Support ──────────────────────────────────────────────────── */

async function watchRewarded() {
  openSheet('Thank you', 'Playing a short video. Nothing is unlocked — this simply pays for the app.', sheet => {
    const label = el('p', { class: 'muted', text: 'Playing…' });
    sheet.append(label);
    money.showRewardedVideo().then(() => {
      closeSheet();
      toast('That genuinely helps. Thank you.');
      if (currentView === 'settings') renderSettings();
    });
  });
}

let giveMode = 'monthly';   // flips to 'once' automatically when monthly is unset
let coverFee = false;

function renderGive() {
  const host = $('#giveBody');
  host.innerHTML = '';

  host.append(
    el('div', { class: 'promo' },
      el('h3', { text: 'We will never charge you to hear the Bible' }),
      el('p', { text: 'Reading and listening to scripture should cost nobody a penny, so it never will here. No subscription, no locked chapters, no account — for you and for everyone who opens this app.' }),
      el('p', { text: 'If you are able and willing, a tip is genuinely appreciated. It goes straight into making the app better and into getting the word of God into more hands. If you are not able, please keep listening with our blessing — that is exactly what it is here for.' })
    )
  );

  host.append(el('h3', { class: 'genre-head', text: 'Leave a tip' }));

  const status = money.donationStatus();

  // Monthly first when it is available: a recurring gift is worth several times
  // a one-off, and whichever option is presented first is the one most people
  // take. It is only offered when there are links behind it.
  if (status.monthlyReady) {
    const seg = el('div', { class: 'seg' },
      el('button', { class: `seg-btn${giveMode === 'monthly' ? ' is-on' : ''}`, text: 'Monthly', onclick: () => { giveMode = 'monthly'; renderGive(); } }),
      el('button', { class: `seg-btn${giveMode === 'once' ? ' is-on' : ''}`, text: 'One time', onclick: () => { giveMode = 'once'; renderGive(); } })
    );
    host.append(seg);
  } else {
    giveMode = 'once';
  }

  const amounts = giveMode === 'monthly' ? money.MONTHLY_AMOUNTS : money.TIP_AMOUNTS;
  const grid = el('div', { class: 'chapter-grid', style: 'grid-template-columns:repeat(auto-fill,minmax(96px,1fr))' });

  for (const amount of amounts) {
    grid.append(el('button', {
      class: 'chapter-btn',
      style: 'aspect-ratio:auto;padding:14px 8px;font-size:17px;flex-direction:column;display:flex;gap:2px',
      onclick: () => sendTip(amount),
    },
      el('span', { text: `$${amount}` }),
      el('small', { style: 'font-size:10.5px;opacity:.65;font-weight:500',
        text: giveMode === 'monthly' ? 'a month' : `≈$${money.netFrom(amount).toFixed(2)} lands` })
    ));
  }

  if (giveMode === 'once') {
    grid.append(el('button', {
      class: 'chapter-btn', style: 'aspect-ratio:auto;padding:14px 8px;font-size:15px',
      text: 'Other',
      onclick: () => sendTip(null),
    }));
  }
  host.append(grid);

  // Offering to cover the fee is the single biggest thing that changes how much
  // of a gift actually arrives — on a $10 gift it is the difference between
  // $9.41 and the full $10.
  if (giveMode === 'once' && money.canCoverFee()) {
    const toggle = el('button', { class: 'row', style: 'border-radius:14px;margin-top:10px',
      onclick: () => { coverFee = !coverFee; renderGive(); } },
      el('div', {},
        el('b', { text: 'Cover the processing fee' }),
        el('small', { text: `Adds about ${money.feeSummary()} so the whole gift arrives. Entirely optional.` })
      ),
      el('span', { class: `switch${coverFee ? ' is-on' : ''}` })
    );
    host.append(toggle);
  }

  host.append(el('p', { class: 'muted', style: 'margin-top:12px', text: money.tipRailLabel() }));

  // Setup status. Visible only while donations are not yet connected, so a
  // half-finished configuration is never mistaken for a working one.
  if (!status.ready || status.missing.length) {
    host.append(
      el('div', { class: 'card', style: 'margin-top:14px' },
        el('p', { class: 'ad-label', text: status.ready ? 'Setup — partly done' : 'Setup — not receiving yet' }),
        el('h3', { text: `Provider: ${status.provider}` }),
        el('p', { text: status.ready
          ? 'Donations work, but some amounts fall back to the “choose your own” page.'
          : 'No payment page is connected, so the buttons above are in demo mode and nothing is charged.' }),
        el('ul', { style: 'margin:10px 0 0;padding-left:18px' },
          ...status.missing.map(m => el('li', { class: 'muted', style: 'margin-bottom:4px', text: m }))),
        el('p', { class: 'muted', style: 'margin-top:10px', text: 'See SETUP-DONATIONS.md for the steps.' })
      )
    );
  }

  const given = money.totalTipped();
  if (given > 0) {
    host.append(
      el('div', { class: 'card', style: 'margin-top:20px' },
        el('h3', { text: 'Thank you, truly' }),
        el('p', { text: `You have given $${given.toFixed(2)} across ${money.tipCount()} ${money.tipCount() === 1 ? 'gift' : 'gifts'}. It matters more than you know.` })
      )
    );
  }

  host.append(el('h3', { class: 'genre-head', text: 'Dedicate a reading' }));
  host.append(
    el('div', { class: 'set-group' },
      row('Dedicate a chapter', 'In memory of someone, or in their honour', el('span', { class: 'val', text: 'Dedicate' }), openDedicationSheet)
    )
  );

  const mine = money.dedications();
  if (mine.length) {
    for (const d of mine.slice(0, 5)) {
      host.append(
        el('button', {
          class: 'result',
          onclick: () => { setView('listen'); player.goTo(d.book, d.chapter, 0, { play: false }); },
        },
          el('b', { text: d.ref }),
          el('span', { text: d.message ? `${d.name} — ${d.message}` : d.name })
        )
      );
    }
  }

  host.append(el('h3', { class: 'genre-head', text: 'Other ways to help' }));
  host.append(
    el('div', { class: 'set-group' },
      row('Watch a short video', 'Costs you a minute and nothing else', el('span', { class: 'val', text: 'Watch' }), watchRewarded),
      row('Share the app', 'The simplest way to spread the word', el('span', { class: 'val', text: 'Share' }), shareApp),
      row('Just keep listening', 'Every chapter you hear supports it too', el('span', { class: 'val', text: '♥' }))
    )
  );
}

function openDedicationSheet() {
  const c = player.current();
  openSheet('Dedicate this reading', `${c.ref} will carry a dedication whenever you open it.`, sheet => {
    const field = (placeholder, maxLength) => el('input', {
      type: 'text', placeholder, maxlength: maxLength,
      style: 'width:100%;padding:13px 15px;border-radius:13px;font-size:15px;background:var(--surface);border:1px solid var(--line);color:var(--text);margin-bottom:8px',
    });

    const name = field('In memory of…', 60);
    const message = field('A few words (optional)', 140);
    sheet.append(name, message);

    let chosen = money.DEDICATION_AMOUNTS[0];
    const opts = el('div', { class: 'opt-list', style: 'margin-top:10px' });
    const paint = () => {
      opts.innerHTML = '';
      for (const amount of money.DEDICATION_AMOUNTS) {
        opts.append(el('button', {
          class: `opt${chosen === amount ? ' is-on' : ''}`,
          text: `$${amount}`,
          onclick: () => { chosen = amount; paint(); },
        }));
      }
    };
    paint();
    sheet.append(opts);

    const go = el('button', {
      class: 'btn wide', style: 'margin-top:12px', text: 'Dedicate',
      onclick: async () => {
        go.disabled = true;
        go.textContent = 'Just a moment…';
        try {
          const result = await money.dedicateChapter({
            book: c.book, chapter: c.chapter, ref: c.ref,
            name: name.value, message: message.value, amount: chosen,
          });
          closeSheet();
          toast(result.pending ? 'Opening a secure checkout — thank you.' : 'Dedicated. Thank you.');
          lastRenderedChapter = '';   // force the reader to redraw with the dedication
          renderNow();
          renderGive();
        } catch (err) {
          go.disabled = false;
          go.textContent = 'Dedicate';
          toast(err.message);
        }
      },
    });
    sheet.append(go);
    sheet.append(el('p', { class: 'muted', style: 'margin-top:12px;text-align:center', text: money.tipRailLabel() }));
  });
}

async function sendTip(amount) {
  const monthly = giveMode === 'monthly';

  if (amount === null) {
    return openSheet('Choose an amount', 'Any amount at all, and thank you.', sheet => {
      const input = el('input', { type: 'number', min: '1', step: '1', value: '25', style: 'width:100%;padding:13px 15px;border-radius:13px;font-size:16px;background:var(--surface);border:1px solid var(--line);color:var(--text)' });
      sheet.append(input);
      sheet.append(el('button', {
        class: 'btn wide', style: 'margin-top:12px', text: 'Continue',
        onclick: () => {
          const value = Number(input.value);
          if (!Number.isFinite(value) || value < 1) return toast('Enter an amount of $1 or more.');
          closeSheet();
          sendTip(value);
        },
      }));
    });
  }

  // Covering the fee means paying a little more so the round number arrives, so
  // the donor is told the exact figure before the payment page opens.
  const feeCovered = coverFee && !monthly && money.canCoverFee();
  const charged = feeCovered ? money.grossFor(amount) : amount;

  try {
    const result = await money.tip(charged, { monthly, feeCovered });
    if (result.pending) {
      toast(feeCovered
        ? `Enter $${charged.toFixed(2)} to cover the fee — thank you.`
        : 'Opening a secure checkout — thank you.');
    } else {
      toast('Thank you — that genuinely helps.');
    }
    renderGive();
  } catch (err) {
    toast(err.message);
  }
}

async function shareApp() {
  const data = {
    title: 'Lantern — the Bible, read aloud',
    text: 'A free app that reads the Bible aloud. No subscription, no account.',
    url: location.origin,
  };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(data.url);
      toast('Link copied.');
    }
  } catch {
    /* the listener dismissed the share sheet */
  }
}

function handleAdAction(action) {
  if (action === 'tip') return money.donationsAvailable() ? setView('give') : setView('plans');
  if (action === 'rewarded') return watchRewarded();
  if (action === 'plans') return setView('plans');
  if (action === 'offline') return startDownload();
}

/* ── Offline download ─────────────────────────────────────────── */

async function startDownload() {
  const translation = store.get().translation;
  if (store.get().offline.includes(translation)) {
    return toast('Already saved on this device.');
  }

  openSheet('Downloading', `Saving ${lib.TRANSLATIONS[translation].name} for offline listening.`, sheet => {
    const bar = el('div', { class: 'bar' }, el('i', { style: 'width:0%' }));
    const label = el('p', { class: 'muted', style: 'margin-top:10px', text: 'Starting…' });
    sheet.append(bar, label);

    lib.fetchAllBooks(translation, (done, total) => {
      bar.firstChild.style.width = `${Math.round((done / total) * 100)}%`;
      label.textContent = `${done} of ${total} books saved`;
    })
      .then(() => {
        store.set({ offline: [...store.get().offline, translation] });
        closeSheet();
        toast('Saved. This translation now works with no connection.');
        renderSettings();
      })
      .catch(err => {
        closeSheet();
        toast(`Download failed: ${err.message}`);
      });
  });
}

/* ── Theme ────────────────────────────────────────────────────── */

export function applyTheme() {
  const theme = store.get().theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#faf6ef' : '#14110f');
}

/* ── Wiring ───────────────────────────────────────────────────── */

export function bind() {
  $$('[data-nav]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.nav)));

  $('#playHero').addEventListener('click', () => { speech.unlock(); player.toggle(); });
  $('#miniPlay').addEventListener('click', e => { e.stopPropagation(); speech.unlock(); player.toggle(); });
  $('#mini').addEventListener('click', () => setView('listen'));

  $('#prevVerse').addEventListener('click', () => player.stepVerse(-1));
  $('#nextVerse').addEventListener('click', () => player.stepVerse(1));
  $('#prevChapter').addEventListener('click', () => player.stepChapter(-1));
  $('#nextChapter').addEventListener('click', () => player.stepChapter(1));

  $('#speedBtn').addEventListener('click', openSpeedSheet);
  $('#sleepBtn').addEventListener('click', openSleepSheet);
  $('#voiceBtn').addEventListener('click', openVoiceSheet);
  $('#toneBtn').addEventListener('click', openToneSheet);
  $('#translationChip').addEventListener('click', openTranslationSheet);

  $('#bookmarkBtn').addEventListener('click', () => {
    const c = player.current();
    if (!c.loaded) return;
    const added = store.toggleBookmark({
      translation: c.translation, book: c.book, chapter: c.chapter, verse: c.verse,
      ref: `${c.ref}:${c.verse + 1}`, text: c.verses[c.verse] ?? '',
    });
    toast(added ? 'Bookmarked.' : 'Bookmark removed.');
    renderNow();
  });

  $('#shareBtn').addEventListener('click', async () => {
    const c = player.current();
    if (!c.loaded || !c.verses[c.verse]) return;
    const btn = $('#shareBtn');
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const how = await share.shareVerse(c.verses[c.verse], `${c.ref}:${c.verse + 1}`);
      if (how === 'downloaded') toast('Verse card saved.');
      else if (how === 'copied') toast('Verse copied.');
      else if (how === 'shared') toast('Thank you for sharing.');
    } catch (err) {
      toast(`Could not share: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Share verse';
    }
  });

  $('#testamentSeg').addEventListener('click', e => {
    const btn = e.target.closest('[data-testament]');
    if (!btn) return;
    testament = btn.dataset.testament;
    $$('#testamentSeg .seg-btn').forEach(b => b.classList.toggle('is-on', b === btn));
    renderLibrary();
  });

  $('#searchForm').addEventListener('submit', runSearch);
  $('#scrim').addEventListener('click', closeSheet);

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') return closeSheet();
    if (e.code === 'Space') { e.preventDefault(); speech.unlock(); player.toggle(); }
    if (e.key === 'ArrowRight') player.stepVerse(1);
    if (e.key === 'ArrowLeft') player.stepVerse(-1);
  });

  // Store builds cannot link out to an external payment page, so the Give tab
  // is removed rather than left showing a control that would fail.
  if (!money.donationsAvailable()) {
    document.querySelector('.tabbar [data-nav="give"]')?.remove();
    document.querySelector('[data-view="give"]')?.remove();
  }

  // The player banner lives for the whole session, so it mounts once.
  mountAd($('#adSlotPlayer'), money.PLACEMENTS.player);

  player.on('change', renderNow);
  player.on('state', renderNow);
  player.on('error', err => toast(err.message));
}
