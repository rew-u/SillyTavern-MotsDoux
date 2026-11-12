/*
 * Mots Doux — learn a language while roleplaying with your favourite characters.
 *
 * The extension adds a short instruction to the prompt so the character weaves
 * words of the target language into replies, marked like [[la pluie|дождь]].
 * Marked words are rendered with translations, collected into a personal
 * dictionary and reviewed with flashcards. Words you learn are passed back to
 * the model so it uses them freely, and words you are learning get reused.
 */

const MODULE = 'motsDoux';
const PROMPT_KEY = 'MOTS_DOUX';
const IN_CHAT = 1;          // extension_prompt_types.IN_CHAT
const ROLE_SYSTEM = 0;      // extension_prompt_roles.SYSTEM
const MARKER_RE = /\[\[([!+#]?)([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
// Marker prefixes: none = word, + = set expression / collocation, # = swear word or crude slang, ! = correction.
const PREFIX_KIND = { '': 'word', '+': 'phrase', '#': 'slang', '!': 'fix' };
const DAY = 24 * 60 * 60 * 1000;
const BOX_DAYS = [0, 1, 2, 4, 7, 14]; // Leitner boxes; reaching the last one = learned

const LANGS = {
    fr: { en: 'French', ru: 'французский', tts: 'fr-FR', flag: '🇫🇷' },
    es: { en: 'Spanish', ru: 'испанский', tts: 'es-ES', flag: '🇪🇸' },
    de: { en: 'German', ru: 'немецкий', tts: 'de-DE', flag: '🇩🇪' },
    it: { en: 'Italian', ru: 'итальянский', tts: 'it-IT', flag: '🇮🇹' },
    pt: { en: 'Portuguese', ru: 'португальский', tts: 'pt-PT', flag: '🇵🇹' },
    en: { en: 'English', ru: 'английский', tts: 'en-US', flag: '🇬🇧' },
    nl: { en: 'Dutch', ru: 'нидерландский', tts: 'nl-NL', flag: '🇳🇱' },
    pl: { en: 'Polish', ru: 'польский', tts: 'pl-PL', flag: '🇵🇱' },
    tr: { en: 'Turkish', ru: 'турецкий', tts: 'tr-TR', flag: '🇹🇷' },
    ja: { en: 'Japanese', ru: 'японский', tts: 'ja-JP', flag: '🇯🇵' },
    ko: { en: 'Korean', ru: 'корейский', tts: 'ko-KR', flag: '🇰🇷' },
    zh: { en: 'Chinese (Mandarin)', ru: 'китайский', tts: 'zh-CN', flag: '🇨🇳' },
    ru: { en: 'Russian', ru: 'русский', tts: 'ru-RU', flag: '🇷🇺' },
    uk: { en: 'Ukrainian', ru: 'украинский', tts: 'uk-UA', flag: '🇺🇦' },
};

const LEVELS = {
    A0: 'Use only 1–2 very common single words or set phrases per reply: greetings, thanks, yes/no, terms of endearment, everyday objects in the scene.',
    A1: 'Use about 3–5 short words or short phrases per reply: everyday nouns with their article, basic present-tense verbs, greetings, numbers, polite phrases, endearments.',
    A2: 'Use about 5–8 phrases per reply, including one or two short simple sentences (present tense, near future, simple past).',
    B1: 'Write roughly a third of the character\'s spoken lines in simple TARGET. Mark the phrases the learner may not know; narration stays in NATIVE.',
    B2: 'Write most of the character\'s spoken lines in TARGET; narration may stay in NATIVE. Mark only less common words and idioms.',
    C1: 'Write the character\'s speech and most narration in TARGET. Mark only rare words, idioms and slang.',
};

const DENSITY = {
    few: 'Keep it light: stay at the low end of that amount.',
    normal: '',
    many: 'Lean towards the high end of that amount, the learner wants more practice.',
};

const LEVEL_UP = { A0: 30, A1: 150, A2: 400, B1: 900 };

// Which set expressions are worth teaching at each level (language-agnostic on purpose).
const PHRASES = {
    A0: { per: 'about one', what: 'fixed everyday formulas a beginner needs right away: greetings and goodbyes, thanks, apologies, "how are you", "no problem", "of course", "see you soon"' },
    A1: { per: 'about one', what: 'high-frequency fixed expressions and verb + noun combinations of daily life: being hungry, cold or tired, doing the shopping, having time, "it\'s fine", "I don\'t know", "here you are", "see you later"' },
    A2: { per: 'one or two', what: 'common collocations and simple idioms: needing something, being fed up, being worth it, feeling like doing something, taking a break, verbs with their usual preposition, linking phrases like "by the way" and "anyway"' },
    B1: { per: 'one or two', what: 'idiomatic expressions of everyday conversation, discourse markers, typical collocations, verbs with fixed prepositions, light figurative idioms' },
    B2: { per: 'two or three', what: 'figurative idioms, colloquial set expressions, typical native collocations, set comparisons, phrases with register nuances' },
    C1: { per: 'two or three', what: 'rich idioms, proverbs and sayings, culturally loaded expressions, wordplay, register-specific set phrases' },
};

const DEFAULTS = {
    enabled: true,
    target: 'fr',
    native: 'ru',
    level: 'A1',
    density: 'normal',
    display: 'ruby',
    corrections: true,
    phrases: true,
    swears: false,
    reuse: true,
    knownPlain: true,
    autoAdd: true,
    toast: true,
    depth: 1,
    reverseCards: false,
    dict: {},
    stats: { streak: 0, lastDay: '', reviews: 0, hinted: {} },
};

/* ---------------------------------------------------------------- i18n --- */

const STR = {
    ru: {
        title: 'Mots Doux — язык в ролевых',
        enabled: 'Включено',
        target: 'Учу язык',
        native: 'Мой язык',
        level: 'Уровень',
        density: 'Сколько слов',
        density_few: 'Поменьше', density_normal: 'Обычно', density_many: 'Побольше',
        display: 'Как показывать перевод',
        display_ruby: 'Над словом', display_tooltip: 'При наведении', display_blur: 'Размыт, нажми чтобы открыть',
        corrections: 'Исправлять мои ошибки, когда пишу на языке',
        phrases: 'Учить устойчивые выражения и сочетания слов',
        swears: 'Учить мат и грубый сленг 🌶 (18+)',
        kind_phrase: 'выражение', kind_slang: '🌶 мат / сленг', kind_fix: 'исправление',
        phrasesF: 'Выражения', slangF: '🌶 Сленг',
        reuse: 'Персонажи повторяют слова, которые я учу',
        knownPlain: 'Выученные слова идут без перевода',
        autoAdd: 'Автоматически добавлять новые слова в словарик',
        toast: 'Уведомлять о новых словах',
        depth: 'Глубина вставки инструкции',
        openDict: 'Словарик',
        openCards: 'Карточки',
        preview: 'Посмотреть инструкцию',
        streak: n => `${n} ${plural(n, ['день', 'дня', 'дней'])} подряд`,
        words: n => `${n} ${plural(n, ['слово', 'слова', 'слов'])}`, known: 'выучено', due: 'к повторению',
        search: 'Поиск…',
        all: 'Все', learning: 'Учу', knownF: 'Знаю', fixes: 'Исправления',
        add: '+ Слово', harvest: 'Собрать из этого чата',
        exportAnki: 'Экспорт в Anki', exportJson: 'Бэкап', importJson: 'Загрузить бэкап', clear: 'Очистить',
        empty: 'Пока пусто. Поиграй с персонажем — слова появятся сами ✨',
        addTerm: 'Слово или фраза на изучаемом языке:', addTr: 'Перевод:',
        editTr: 'Новый перевод:',
        confirmDelete: 'Удалить слово?',
        confirmClear: 'Удалить весь словарик для этого языка? Сначала лучше сделать бэкап.',
        newWords: n => `Словарик +${n} ${plural(n, ['слово', 'слова', 'слов'])} ✨`,
        harvested: n => `Собрано новых слов: ${n}`,
        imported: n => `Загружено слов: ${n}`,
        show: 'Показать', remember: 'Помню', forgot: 'Не помню',
        doneToday: 'На сегодня всё повторено! 🌙',
        extra: 'Повторить 10 случайных',
        reverse: 'Наоборот: с перевода',
        left: 'осталось',
        inDict: 'В словарике', toDict: 'В словарик', markKnown: 'Знаю', markLearning: 'Учить снова',
        levelUp: (n, lvl) => `Ты знаешь уже ${n} слов! Может, пора на ${lvl}? ✨`,
        knownToast: t => `«${t}» — выучено! 🎉`,
        fixTitle: 'Исправление',
        disabled: 'Mots Doux выключен',
        on: 'Mots Doux включён', off: 'Mots Doux выключен',
    },
    en: {
        title: 'Mots Doux — language in roleplay',
        enabled: 'Enabled',
        target: 'Learning',
        native: 'My language',
        level: 'Level',
        density: 'How many words',
        density_few: 'Fewer', density_normal: 'Normal', density_many: 'More',
        display: 'Show translation',
        display_ruby: 'Above the word', display_tooltip: 'On hover', display_blur: 'Blurred, tap to reveal',
        corrections: 'Correct my mistakes when I write in the language',
        phrases: 'Teach set expressions and word combinations',
        swears: 'Teach swear words and crude slang 🌶 (18+)',
        kind_phrase: 'expression', kind_slang: '🌶 swear / slang', kind_fix: 'correction',
        phrasesF: 'Expressions', slangF: '🌶 Slang',
        reuse: 'Characters reuse the words I\'m learning',
        knownPlain: 'Learned words appear without translation',
        autoAdd: 'Add new words to the dictionary automatically',
        toast: 'Notify about new words',
        depth: 'Instruction injection depth',
        openDict: 'Dictionary',
        openCards: 'Flashcards',
        preview: 'Preview instruction',
        streak: n => `${n}-day streak`,
        words: n => `${n} word${n === 1 ? '' : 's'}`, known: 'learned', due: 'due',
        search: 'Search…',
        all: 'All', learning: 'Learning', knownF: 'Known', fixes: 'Corrections',
        add: '+ Word', harvest: 'Collect from this chat',
        exportAnki: 'Export to Anki', exportJson: 'Backup', importJson: 'Restore backup', clear: 'Clear',
        empty: 'Nothing yet. Play with a character and words will appear here ✨',
        addTerm: 'Word or phrase in the target language:', addTr: 'Translation:',
        editTr: 'New translation:',
        confirmDelete: 'Delete this word?',
        confirmClear: 'Delete the whole dictionary for this language? Make a backup first.',
        newWords: n => `Dictionary +${n} word${n === 1 ? '' : 's'} ✨`,
        harvested: n => `New words collected: ${n}`,
        imported: n => `Words imported: ${n}`,
        show: 'Show', remember: 'Got it', forgot: 'Forgot',
        doneToday: 'All reviews done for today! 🌙',
        extra: 'Review 10 random',
        reverse: 'Reverse: from translation',
        left: 'left',
        inDict: 'In dictionary', toDict: 'Add to dictionary', markKnown: 'I know it', markLearning: 'Learn again',
        levelUp: (n, lvl) => `You know ${n} words already! Maybe it's time for ${lvl}? ✨`,
        knownToast: t => `“${t}” — learned! 🎉`,
        fixTitle: 'Correction',
        disabled: 'Mots Doux is off',
        on: 'Mots Doux on', off: 'Mots Doux off',
    },
};

function plural(n, forms) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
}

function T() {
    return S().native === 'ru' || S().native === 'uk' ? STR.ru : STR.en;
}

/* ------------------------------------------------------------- helpers --- */

const ctx = () => SillyTavern.getContext();

function S() {
    const all = ctx().extensionSettings;
    if (!all[MODULE]) all[MODULE] = structuredClone(DEFAULTS);
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    for (const [k, v] of Object.entries(DEFAULTS.stats)) {
        if (s.stats[k] === undefined) s.stats[k] = structuredClone(v);
    }
    return s;
}

function save() {
    ctx().saveSettingsDebounced();
}

function dict() {
    const s = S();
    if (!s.dict[s.target]) s.dict[s.target] = {};
    return s.dict[s.target];
}

function langName(code, inLang = 'en') {
    const l = LANGS[code];
    if (!l) return code;
    return inLang === 'ru' ? l.ru : l.en;
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function keyOf(term) {
    return String(term).toLowerCase().normalize('NFC')
        .replace(/[\s ]+/g, ' ')
        .replace(/^[\s"'«“¡¿]+|[\s"'»”.,!?;:…]+$/g, '')
        .trim();
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function touchStreak() {
    const st = S().stats;
    const t = today();
    if (st.lastDay === t) return;
    const y = new Date(Date.now() - DAY);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    st.streak = st.lastDay === yesterday ? st.streak + 1 : 1;
    st.lastDay = t;
    save();
    refreshStats();
}

function toast(msg, kind = 'info') {
    if (globalThis.toastr) globalThis.toastr[kind](msg, '', { timeOut: 2500 });
}

/* ----------------------------------------------------------------- tts --- */

function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const code = LANGS[S().target]?.tts || S().target;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = code;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang === code) || voices.find(v => v.lang?.startsWith(code.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
}

/* ---------------------------------------------------------- dictionary --- */

/** Entries that take part in reviews and the prompt (no corrections; slang only when enabled). */
function isActive(e) {
    return e.kind !== 'fix' && (e.kind !== 'slang' || S().swears);
}

function stats() {
    const entries = Object.values(dict());
    const now = Date.now();
    return {
        total: entries.length,
        known: entries.filter(e => e.status === 'known').length,
        due: entries.filter(e => isActive(e) && e.status !== 'known' && (e.due ?? 0) <= now).length,
    };
}

function contextAround(raw, index, length) {
    const plain = s => s.replace(MARKER_RE, (_m, _f, t) => t);
    let start = Math.max(0, raw.lastIndexOf('\n', index) + 1, index - 120);
    let end = raw.indexOf('\n', index + length);
    if (end === -1) end = raw.length;
    end = Math.min(end, index + length + 120);
    // Never cut a neighbouring marker in half.
    const openS = raw.lastIndexOf('[[', start);
    if (openS !== -1 && openS < start && raw.lastIndexOf(']]', start - 1) < openS) start = openS;
    const openE = raw.lastIndexOf('[[', end - 1);
    if (openE !== -1 && raw.lastIndexOf(']]', end - 1) < openE) {
        const closeE = raw.indexOf(']]', openE);
        if (closeE !== -1) end = closeE + 2;
    }
    let text = plain(raw.slice(start, end)).replace(/[*_]/g, '').trim();
    if (start > 0 && raw[start - 1] !== '\n') text = '…' + text;
    if (end < raw.length && raw[end] !== '\n') text += '…';
    return text;
}

/** Adds or bumps a word. Returns true if it was new. */
function upsert({ term, tr, kind = 'word', ctxText = '', char = '' }) {
    const d = dict();
    const key = (kind === 'fix' ? '!' : '') + keyOf(term);
    if (!key || key === '!') return false;
    const e = d[key];
    if (e) {
        e.seen = (e.seen || 0) + 1;
        if (e.kind === 'word' && (kind === 'phrase' || kind === 'slang')) e.kind = kind;
        if (!e.tr && tr) e.tr = tr;
        if (ctxText && !e.ctx) e.ctx = ctxText;
        return false;
    }
    d[key] = {
        term: term.trim(),
        tr: (tr || '').trim(),
        kind,
        ctx: ctxText,
        char,
        added: Date.now(),
        seen: 1,
        box: 0,
        due: Date.now(),
        status: 'learning',
    };
    return true;
}

function harvestText(raw, char) {
    let added = 0;
    for (const m of raw.matchAll(MARKER_RE)) {
        const [full, prefix, term, tr] = m;
        const kind = PREFIX_KIND[prefix] || 'word';
        if (kind !== 'fix' && !tr) continue;
        if (kind === 'slang' && !S().swears) continue;
        if (upsert({ term, tr, kind, ctxText: contextAround(raw, m.index, full.length), char })) {
            added++;
        }
    }
    return added;
}

function harvestMessage(mesId, silent = false) {
    const s = S();
    if (!s.enabled || !s.autoAdd) return 0;
    const msg = ctx().chat?.[mesId];
    if (!msg || msg.is_user || msg.is_system || !msg.mes) return 0;
    const added = harvestText(msg.mes, msg.name || '');
    if (added) {
        save();
        touchStreak();
        updatePrompt();
        refreshStats();
        if (!silent && s.toast) toast(T().newWords(added), 'success');
    }
    return added;
}

function setStatus(key, status) {
    const e = dict()[key];
    if (!e) return;
    e.status = status;
    if (status === 'known') {
        e.box = BOX_DAYS.length - 1;
    } else {
        e.box = 0;
        e.due = Date.now();
    }
    save();
    updatePrompt();
    refreshStats();
    rerenderAll();
    if (status === 'known') maybeLevelUp();
}

function maybeLevelUp() {
    const s = S();
    const need = LEVEL_UP[s.level];
    if (!need) return;
    const known = stats().known;
    const hintKey = `${s.target}:${s.level}`;
    if (known >= need && !s.stats.hinted[hintKey]) {
        const order = Object.keys(LEVELS);
        const next = order[order.indexOf(s.level) + 1];
        s.stats.hinted[hintKey] = true;
        save();
        toast(T().levelUp(known, next), 'success');
    }
}

/* -------------------------------------------------------------- prompt --- */

function buildPrompt() {
    const s = S();
    const target = langName(s.target);
    const native = langName(s.native);
    const entries = Object.values(dict()).filter(isActive);
    const lines = [];

    lines.push(`[Language practice mode: the user is learning ${target} (level ${s.level}); their native language is ${native}.`);
    lines.push(`Stay fully in character: keep the characters' personalities, voices and the story exactly as usual. The main language of the reply stays as it was; you only weave ${target} into it where it feels natural for the character — greetings, endearments, exclamations, small talk, objects in the scene.`);
    lines.push(LEVELS[s.level].replace(/TARGET/g, target).replace(/NATIVE/g, native) + (DENSITY[s.density] ? ' ' + DENSITY[s.density] : ''));
    lines.push(`Wrap every ${target} word or phrase the learner may not know exactly like this: [[${target} text|${native} translation]]. Example for a French learner with English as native language: [[la pluie|the rain]]. Give nouns with their article where the language has one. Keep each marked piece short, never nest markers, and do not add translations in parentheses — the marker already carries the translation.`);

    if (s.phrases) {
        const ph = PHRASES[s.level];
        lines.push(`Teach set expressions and natural word combinations too, not only single words: in each reply weave in ${ph.per} ${target} fixed expression(s) or typical collocation(s) useful at level ${s.level} — ${ph.what}. Mark the whole expression as one unit with a plus sign: [[+${target} expression|${native} meaning]]. If the literal meaning differs, add it briefly, e.g. for French with English as native language: [[+avoir le cafard|to feel down (lit. "to have the cockroach")]]. Never split such an expression into separate word markers. Prefer expressions that fit the scene and the character's voice.`);
    }
    if (s.swears) {
        lines.push(`The user is an adult and has opted in to learning ${target} profanity, swear words and crude slang. When it fits the character and the moment (anger, surprise, banter, passion, rough or casual characters), let the character use real ${target} swear words, insults and vulgar or street slang — the authentic ones native speakers actually say, not softened textbook versions. Mark each with a hash: [[#${target} word|closest ${native} equivalent — how rude: mild / rude / very vulgar]]. Don't force them into every reply: at most about one per reply, only where it suits the scene.`);
    } else {
        lines.push(`Keep the ${target} you weave in free of swear words and vulgar slang.`);
    }

    if (s.knownPlain) {
        const known = entries.filter(e => e.status === 'known').sort((a, b) => b.added - a.added).slice(0, 60);
        if (known.length) {
            lines.push(`Words and expressions the learner already knows — use them freely as plain ${target} without markers: ${known.map(e => e.term).join(', ')}.`);
        }
    }
    if (s.reuse) {
        const now = Date.now();
        const practising = entries
            .filter(e => e.status !== 'known')
            .sort((a, b) => ((a.due ?? 0) <= now ? 0 : 1) - ((b.due ?? 0) <= now ? 0 : 1) || b.added - a.added)
            .slice(0, 12);
        if (practising.length) {
            lines.push(`Words and expressions the learner is practising now — reuse one or two of them naturally when it fits, with the same markers as before: ${practising.map(e => (e.kind === 'phrase' ? '+' : e.kind === 'slang' ? '#' : '') + e.term).join(', ')}.`);
        }
    }
    if (s.corrections) {
        lines.push(`If the user writes something in ${target} with a mistake, the character may naturally echo the correct form, and at the very end of the reply add one marker [[!corrected phrase|short explanation in ${native}]]. If there is no mistake, add nothing.`);
    }
    lines.push(']');
    return lines.join('\n');
}

function updatePrompt() {
    const c = ctx();
    const s = S();
    c.setExtensionPrompt(PROMPT_KEY, s.enabled ? buildPrompt() : '', IN_CHAT, Number(s.depth) || 0, false, ROLE_SYSTEM);
}

/* ------------------------------------------------------------- render --- */

function buildWord(term, tr, kind = 'word') {
    const s = S();
    const key = keyOf(term);
    const entry = dict()[key];
    const knownCls = (entry?.status === 'known' ? ' md-known' : '') + ` md-kind-${kind}`;
    if (s.display === 'ruby' && tr) {
        const el = document.createElement('ruby');
        el.className = 'md-word md-ruby' + knownCls;
        el.dataset.kind = kind;
        el.dataset.key = key;
        el.dataset.term = term;
        el.dataset.tr = tr;
        el.append(document.createTextNode(term));
        const rt = document.createElement('rt');
        // Above the word show the short meaning; the literal translation in brackets stays in the popover.
        rt.textContent = tr.replace(/\s*\((?:букв|лит|lit)\.?[^)]*\)\s*$/i, '') || tr;
        el.append(rt);
        return el;
    }
    const el = document.createElement('span');
    el.className = 'md-word' + knownCls + (s.display === 'blur' ? ' md-blurmode' : ' md-tipmode');
    el.dataset.kind = kind;
    el.dataset.key = key;
    el.dataset.term = term;
    el.dataset.tr = tr || '';
    el.append(document.createTextNode(term));
    if (s.display === 'blur' && tr) {
        const t = document.createElement('span');
        t.className = 'md-tr md-blur';
        t.textContent = tr;
        el.append(document.createTextNode(' '), t);
    } else if (tr) {
        el.title = tr;
    }
    return el;
}

function buildFix(term, note) {
    const el = document.createElement('span');
    el.className = 'md-fix';
    el.title = T().fixTitle;
    el.dataset.term = term;
    el.dataset.tr = note || '';
    const b = document.createElement('b');
    b.textContent = '✎ ' + term;
    el.append(b);
    if (note) {
        const n = document.createElement('span');
        n.className = 'md-fix-note';
        n.textContent = note;
        el.append(document.createTextNode(' '), n);
    }
    return el;
}

function renderElement(root) {
    if (!root || !S().enabled) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !node.nodeValue.includes('[[')) return NodeFilter.FILTER_REJECT;
            if (node.parentElement?.closest('code, pre, .md-word, .md-fix, textarea')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let last = 0;
        let changed = false;
        for (const m of text.matchAll(MARKER_RE)) {
            const [full, prefix, term, tr] = m;
            const kind = PREFIX_KIND[prefix] || 'word';
            frag.append(document.createTextNode(text.slice(last, m.index)));
            frag.append(kind === 'fix' ? buildFix(term.trim(), tr?.trim()) : buildWord(term.trim(), tr?.trim(), kind));
            last = m.index + full.length;
            changed = true;
        }
        if (!changed) continue;
        frag.append(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
    }
    if (root.textContent.includes('[[')) renderSplitMarkers(root);
}

// Markers whose text got split by the chat formatter (e.g. quotes wrapped in <q>, *emphasis* inside a translation).
// Only inline formatting may sit inside; a marker never spans paragraphs, line breaks or code.
const SPLIT_MARKER_RE = /\[\[([!+#]?)((?:(?!\]\]|\[\[|<\/?(?:p|div|br|pre|code|li|ul|ol|blockquote|h\d|table|tr|td)\b)[\s\S])+?)\]\]/gi;

function renderSplitMarkers(root) {
    const tmp = document.createElement('div');
    const before = root.innerHTML;
    const after = before.replace(SPLIT_MARKER_RE, (full, prefix, inner) => {
        tmp.innerHTML = inner;
        const text = tmp.textContent;
        const bar = text.indexOf('|');
        const term = (bar === -1 ? text : text.slice(0, bar)).trim();
        const tr = bar === -1 ? '' : text.slice(bar + 1).trim();
        if (!term) return full;
        const kind = PREFIX_KIND[prefix.replace(/&amp;/, '')] || 'word';
        return (kind === 'fix' ? buildFix(term, tr) : buildWord(term, tr, kind)).outerHTML;
    });
    if (after !== before) root.innerHTML = after;
}

function renderMessage(mesId) {
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"] .mes_text`);
    renderElement(el);
}

function rerenderAll() {
    // Re-format messages from source so display settings apply to already rendered text.
    const c = ctx();
    document.querySelectorAll('#chat .mes').forEach(mes => {
        const id = Number(mes.getAttribute('mesid'));
        const msg = c.chat?.[id];
        const textEl = mes.querySelector('.mes_text');
        if (!msg || !textEl) return;
        if (textEl.querySelector('.md-word, .md-fix')) {
            textEl.innerHTML = c.messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, id);
        }
        renderElement(textEl);
    });
}

function renderAllSoon() {
    setTimeout(() => document.querySelectorAll('#chat .mes .mes_text').forEach(renderElement), 50);
}

/* ------------------------------------------------------------- popover --- */

let popover = null;

function closePopover() {
    popover?.remove();
    popover = null;
}

function openPopover(target) {
    closePopover();
    const t = T();
    const term = target.dataset.term;
    const tr = target.dataset.tr;
    const isFix = target.classList.contains('md-fix');
    const kind = isFix ? 'fix' : (target.dataset.kind || 'word');
    const key = (isFix ? '!' : '') + keyOf(term);
    const entry = dict()[key];
    const kindLabel = kind === 'word' ? '' : t[`kind_${kind}`];

    popover = document.createElement('div');
    popover.className = 'md-popover';
    popover.innerHTML = `
        <div class="md-pop-term">${esc(term)}
            <button class="md-btn md-say" title="🔊"><i class="fa-solid fa-volume-high"></i></button>
        </div>
        ${kindLabel ? `<div class="md-tag md-tag-${kind}">${esc(kindLabel)}</div>` : ''}
        ${tr ? `<div class="md-pop-tr">${esc(tr)}</div>` : ''}
        ${entry ? `<div class="md-pop-meta">${entry.status === 'known' ? '✓ ' + esc(t.knownF) : '• ' + esc(t.inDict)}</div>` : ''}
        <div class="md-pop-actions">
            ${entry ? '' : `<button class="md-btn md-add">${esc(t.toDict)}</button>`}
            ${!isFix ? (entry?.status === 'known'
                ? `<button class="md-btn md-relearn">${esc(t.markLearning)}</button>`
                : `<button class="md-btn md-know">${esc(t.markKnown)} ✓</button>`) : ''}
        </div>`;
    document.body.append(popover);

    const r = target.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    let top = r.bottom + 6;
    if (top + popover.offsetHeight > window.innerHeight - 8) top = r.top - popover.offsetHeight - 6;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(8, top)}px`;

    popover.querySelector('.md-say')?.addEventListener('click', () => speak(term));
    popover.querySelector('.md-add')?.addEventListener('click', () => {
        const mes = target.closest('.mes');
        const msg = ctx().chat?.[Number(mes?.getAttribute('mesid'))];
        upsert({ term, tr, kind, ctxText: '', char: msg?.name || '' });
        save(); updatePrompt(); refreshStats(); touchStreak();
        closePopover();
    });
    popover.querySelector('.md-know')?.addEventListener('click', () => {
        if (!dict()[key]) upsert({ term, tr, kind });
        setStatus(key, 'known');
        toast(t.knownToast(term), 'success');
        closePopover();
    });
    popover.querySelector('.md-relearn')?.addEventListener('click', () => {
        setStatus(key, 'learning');
        closePopover();
    });
}

function onChatClick(ev) {
    const blur = ev.target.closest('.md-blur');
    if (blur) {
        blur.classList.remove('md-blur');
        ev.stopPropagation();
        return;
    }
    const word = ev.target.closest('.md-word, .md-fix');
    if (word) {
        ev.stopPropagation();
        if (popover && popover.dataset.for === word.dataset.key) {
            closePopover();
        } else {
            openPopover(word);
            popover.dataset.for = word.dataset.key;
        }
        return;
    }
    if (popover && !ev.target.closest('.md-popover')) closePopover();
}

/* ---------------------------------------------------------- dictionary UI --- */

function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportAnki() {
    const clean = s => String(s || '').replace(/[\t\r\n]+/g, ' ');
    const tag = e => `mots-doux ${S().target} ${e.kind === 'phrase' ? 'expression' : e.kind === 'slang' ? 'slang' : e.kind === 'fix' ? 'correction' : 'word'}`;
    const rows = Object.values(dict()).map(e => [e.term, e.tr, e.ctx, e.char, tag(e)].map(clean).join('\t'));
    const header = '#separator:tab\n#html:false\n#columns:Front\tBack\tContext\tCharacter\tTags\n#tags column:5\n';
    download(`mots-doux-${S().target}-anki.txt`, header + rows.join('\n'), 'text/plain;charset=utf-8');
}

function exportJson() {
    const data = { app: 'mots-doux', version: 1, target: S().target, words: dict() };
    download(`mots-doux-${S().target}-backup-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function importJson(onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            const words = data.words || data;
            const d = dict();
            let n = 0;
            for (const [k, v] of Object.entries(words)) {
                if (!v || typeof v.term !== 'string') continue;
                if (!d[k]) n++;
                d[k] = { ...d[k], ...v };
            }
            save(); updatePrompt(); refreshStats();
            toast(T().imported(n), 'success');
            onDone?.();
        } catch (e) {
            console.error('[Mots Doux] import failed', e);
            toast(String(e), 'error');
        }
    });
    input.click();
}

async function openDictionary() {
    const c = ctx();
    const t = T();
    const root = document.createElement('div');
    root.className = 'md-dict';
    let filter = 'all';
    let query = '';

    root.innerHTML = `
        <div class="md-dict-head">
            <h3>${LANGS[S().target]?.flag || ''} ${esc(t.openDict)}</h3>
            <div class="md-dict-stats"></div>
        </div>
        <div class="md-dict-tools">
            <input class="text_pole md-search" type="search" placeholder="${esc(t.search)}">
            <div class="md-filters">
                <button class="md-chip" data-f="all">${esc(t.all)}</button>
                <button class="md-chip" data-f="learning">${esc(t.learning)}</button>
                <button class="md-chip" data-f="known">${esc(t.knownF)}</button>
                <button class="md-chip" data-f="phrase">${esc(t.phrasesF)}</button>
                ${S().swears || Object.values(dict()).some(e => e.kind === 'slang') ? `<button class="md-chip" data-f="slang">${esc(t.slangF)}</button>` : ''}
                <button class="md-chip" data-f="fix">${esc(t.fixes)}</button>
            </div>
        </div>
        <div class="md-list"></div>
        <div class="md-dict-foot">
            <button class="menu_button md-a-add">${esc(t.add)}</button>
            <button class="menu_button md-a-harvest">${esc(t.harvest)}</button>
            <button class="menu_button md-a-anki">${esc(t.exportAnki)}</button>
            <button class="menu_button md-a-json">${esc(t.exportJson)}</button>
            <button class="menu_button md-a-import">${esc(t.importJson)}</button>
            <button class="menu_button md-a-clear redWarningBG">${esc(t.clear)}</button>
        </div>`;

    const list = root.querySelector('.md-list');

    const draw = () => {
        const st = stats();
        root.querySelector('.md-dict-stats').innerHTML =
            `🔥 ${esc(t.streak(S().stats.streak))} · ${esc(t.words(st.total))} · ${st.known} ${esc(t.known)} · ${st.due} ${esc(t.due)}`;
        root.querySelectorAll('.md-chip').forEach(b => b.classList.toggle('active', b.dataset.f === filter));

        const q = keyOf(query);
        const items = Object.entries(dict())
            .filter(([, e]) => filter === 'all'
                || (['fix', 'phrase', 'slang'].includes(filter) ? e.kind === filter : e.kind !== 'fix' && e.status === filter))
            .filter(([k, e]) => !q || k.includes(q) || keyOf(e.tr).includes(q))
            .sort((a, b) => b[1].added - a[1].added);

        if (!items.length) {
            list.innerHTML = `<div class="md-empty">${esc(t.empty)}</div>`;
            return;
        }
        list.innerHTML = items.map(([k, e]) => `
            <div class="md-row ${e.status === 'known' ? 'is-known' : ''} is-${esc(e.kind || 'word')}" data-k="${esc(k)}">
                <div class="md-row-main">
                    <div><span class="md-row-term">${e.kind === 'fix' ? '✎ ' : ''}${esc(e.term)}</span>
                         ${e.kind === 'phrase' || e.kind === 'slang' ? `<span class="md-tag md-tag-${e.kind}">${esc(t[`kind_${e.kind}`])}</span>` : ''}
                         <span class="md-row-tr">${esc(e.tr)}</span></div>
                    ${e.ctx ? `<div class="md-row-ctx">${esc(e.ctx)}${e.char ? ` — <i>${esc(e.char)}</i>` : ''}</div>` : ''}
                </div>
                <div class="md-row-btns">
                    <span class="md-seen" title="×">×${e.seen || 1}</span>
                    <button class="md-btn md-r-say" title="🔊"><i class="fa-solid fa-volume-high"></i></button>
                    ${e.kind === 'fix' ? '' : `<button class="md-btn md-r-known" title="${esc(e.status === 'known' ? t.markLearning : t.markKnown)}">${e.status === 'known' ? '↺' : '✓'}</button>`}
                    <button class="md-btn md-r-edit" title="✎"><i class="fa-solid fa-pen"></i></button>
                    <button class="md-btn md-r-del" title="🗑"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`).join('');
    };

    root.querySelector('.md-search').addEventListener('input', e => { query = e.target.value; draw(); });
    root.querySelectorAll('.md-chip').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; draw(); }));

    list.addEventListener('click', async e => {
        const row = e.target.closest('.md-row');
        if (!row) return;
        const k = row.dataset.k;
        const entry = dict()[k];
        if (!entry) return;
        if (e.target.closest('.md-r-say')) speak(entry.term);
        if (e.target.closest('.md-r-known')) {
            setStatus(k, entry.status === 'known' ? 'learning' : 'known');
            if (entry.status === 'known') toast(t.knownToast(entry.term), 'success');
            draw();
        }
        if (e.target.closest('.md-r-edit')) {
            const v = await c.callGenericPopup(`<b>${esc(entry.term)}</b><br>${esc(t.editTr)}`, c.POPUP_TYPE.INPUT, entry.tr);
            if (typeof v === 'string') { entry.tr = v.trim(); save(); draw(); }
        }
        if (e.target.closest('.md-r-del')) {
            const ok = await c.callGenericPopup(`${esc(t.confirmDelete)}<br><b>${esc(entry.term)}</b>`, c.POPUP_TYPE.CONFIRM);
            if (ok) { delete dict()[k]; save(); updatePrompt(); refreshStats(); draw(); }
        }
    });

    root.querySelector('.md-a-add').addEventListener('click', async () => {
        const term = await c.callGenericPopup(esc(t.addTerm), c.POPUP_TYPE.INPUT, '');
        if (typeof term !== 'string' || !term.trim()) return;
        const tr = await c.callGenericPopup(`<b>${esc(term)}</b><br>${esc(t.addTr)}`, c.POPUP_TYPE.INPUT, '');
        upsert({ term, tr: typeof tr === 'string' ? tr : '' });
        save(); updatePrompt(); refreshStats(); touchStreak(); draw();
    });
    root.querySelector('.md-a-harvest').addEventListener('click', () => {
        let n = 0;
        (ctx().chat || []).forEach(m => {
            if (!m.is_user && !m.is_system && m.mes) n += harvestText(m.mes, m.name || '');
        });
        save(); updatePrompt(); refreshStats();
        toast(t.harvested(n), 'success');
        draw();
    });
    root.querySelector('.md-a-anki').addEventListener('click', exportAnki);
    root.querySelector('.md-a-json').addEventListener('click', exportJson);
    root.querySelector('.md-a-import').addEventListener('click', () => importJson(draw));
    root.querySelector('.md-a-clear').addEventListener('click', async () => {
        const ok = await c.callGenericPopup(esc(t.confirmClear), c.POPUP_TYPE.CONFIRM);
        if (ok) { S().dict[S().target] = {}; save(); updatePrompt(); refreshStats(); draw(); }
    });

    draw();
    await c.callGenericPopup(root, c.POPUP_TYPE.DISPLAY, '', { wide: true, large: true, allowVerticalScrolling: true });
}

/* ---------------------------------------------------------- flashcards --- */

async function openCards() {
    const c = ctx();
    const t = T();
    const root = document.createElement('div');
    root.className = 'md-cards';

    const now = Date.now();
    let queue = Object.entries(dict())
        .filter(([, e]) => isActive(e) && e.status !== 'known' && (e.due ?? 0) <= now)
        .sort((a, b) => (a[1].due ?? 0) - (b[1].due ?? 0))
        .map(([k]) => k);

    const randomTen = () => Object.keys(dict())
        .filter(k => isActive(dict()[k]))
        .sort(() => Math.random() - 0.5)
        .slice(0, 10);

    let revealed = false;

    const draw = () => {
        const reverse = S().reverseCards;
        if (!queue.length) {
            root.innerHTML = `
                <div class="md-card md-card-done">
                    <div class="md-card-big">${esc(t.doneToday)}</div>
                    <div class="md-dict-stats">🔥 ${esc(t.streak(S().stats.streak))}</div>
                    <button class="menu_button md-c-extra">${esc(t.extra)}</button>
                </div>`;
            root.querySelector('.md-c-extra').addEventListener('click', () => { queue = randomTen(); revealed = false; draw(); });
            return;
        }
        const e = dict()[queue[0]];
        if (!e) { queue.shift(); return draw(); }
        const front = reverse ? e.tr : e.term;
        const back = reverse ? e.term : e.tr;
        root.innerHTML = `
            <div class="md-card-top">
                <label class="checkbox_label"><input type="checkbox" class="md-c-rev" ${reverse ? 'checked' : ''}> ${esc(t.reverse)}</label>
                <span>${queue.length} ${esc(t.left)}</span>
            </div>
            <div class="md-card">
                ${e.kind === 'phrase' || e.kind === 'slang' ? `<div class="md-tag md-tag-${e.kind}">${esc(t[`kind_${e.kind}`])}</div>` : ''}
                <div class="md-card-big">${esc(front)}
                    ${reverse ? '' : '<button class="md-btn md-c-say"><i class="fa-solid fa-volume-high"></i></button>'}
                </div>
                ${revealed ? `
                    <div class="md-card-back">${esc(back)}
                        ${reverse ? '<button class="md-btn md-c-say"><i class="fa-solid fa-volume-high"></i></button>' : ''}
                    </div>
                    ${e.ctx ? `<div class="md-row-ctx">${esc(e.ctx)}${e.char ? ` — <i>${esc(e.char)}</i>` : ''}</div>` : ''}
                    <div class="md-card-btns">
                        <button class="menu_button md-c-forgot">${esc(t.forgot)}</button>
                        <button class="menu_button md-c-ok">${esc(t.remember)}</button>
                    </div>`
                : `<div class="md-card-btns"><button class="menu_button md-c-show">${esc(t.show)}</button></div>`}
            </div>`;

        root.querySelector('.md-c-rev').addEventListener('change', ev => {
            S().reverseCards = ev.target.checked; save(); draw();
        });
        root.querySelectorAll('.md-c-say').forEach(b => b.addEventListener('click', () => speak(e.term)));
        root.querySelector('.md-c-show')?.addEventListener('click', () => {
            revealed = true;
            draw();
            if (!reverse) speak(e.term);
        });
        root.querySelector('.md-c-ok')?.addEventListener('click', () => grade(true));
        root.querySelector('.md-c-forgot')?.addEventListener('click', () => grade(false));
    };

    const grade = ok => {
        const key = queue.shift();
        const e = dict()[key];
        if (e) {
            S().stats.reviews++;
            if (ok) {
                e.box = Math.min((e.box || 0) + 1, BOX_DAYS.length - 1);
                e.due = Date.now() + BOX_DAYS[e.box] * DAY;
                if (e.box === BOX_DAYS.length - 1 && e.status !== 'known') {
                    e.status = 'known';
                    toast(t.knownToast(e.term), 'success');
                    maybeLevelUp();
                }
            } else {
                e.box = 1;
                e.due = Date.now() + DAY;
                e.status = 'learning';
                queue.push(key); // once more in this session
            }
            save();
            touchStreak();
            updatePrompt();
            refreshStats();
        }
        revealed = false;
        draw();
    };

    root.addEventListener('keydown', ev => {
        if (ev.key === ' ' && !revealed) { ev.preventDefault(); root.querySelector('.md-c-show')?.click(); }
    });

    draw();
    await c.callGenericPopup(root, c.POPUP_TYPE.DISPLAY, '', { wide: false, large: false });
}

/* ------------------------------------------------------------ settings --- */

function settingsHtml() {
    const s = S();
    const t = T();
    const ui = s.native === 'ru' || s.native === 'uk' ? 'ru' : 'en';
    const langOptions = sel => Object.entries(LANGS)
        .map(([code, l]) => `<option value="${code}" ${code === sel ? 'selected' : ''}>${l.flag} ${esc(ui === 'ru' ? l.ru : l.en)}</option>`)
        .join('');
    const opt = (val, cur, label) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${esc(label)}</option>`;
    const check = (id, label) => `<label class="checkbox_label"><input type="checkbox" data-md="${id}" ${s[id] ? 'checked' : ''}><span>${esc(label)}</span></label>`;

    return `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>💌 ${esc(t.title)}</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content md-settings"><div class="md-settings-inner">
            ${check('enabled', t.enabled)}
            <div class="md-stats-line"></div>
            <div class="md-grid">
                <label>${esc(t.target)}<select class="text_pole" data-md="target">${langOptions(s.target)}</select></label>
                <label>${esc(t.native)}<select class="text_pole" data-md="native">${langOptions(s.native)}</select></label>
                <label>${esc(t.level)}<select class="text_pole" data-md="level">
                    ${Object.keys(LEVELS).map(l => opt(l, s.level, l)).join('')}</select></label>
                <label>${esc(t.density)}<select class="text_pole" data-md="density">
                    ${opt('few', s.density, t.density_few)}${opt('normal', s.density, t.density_normal)}${opt('many', s.density, t.density_many)}</select></label>
                <label>${esc(t.display)}<select class="text_pole" data-md="display">
                    ${opt('ruby', s.display, t.display_ruby)}${opt('tooltip', s.display, t.display_tooltip)}${opt('blur', s.display, t.display_blur)}</select></label>
                <label>${esc(t.depth)}<input class="text_pole" type="number" min="0" max="20" data-md="depth" value="${Number(s.depth)}"></label>
            </div>
            ${check('phrases', t.phrases)}
            ${check('swears', t.swears)}
            ${check('corrections', t.corrections)}
            ${check('reuse', t.reuse)}
            ${check('knownPlain', t.knownPlain)}
            ${check('autoAdd', t.autoAdd)}
            ${check('toast', t.toast)}
            <div class="md-buttons">
                <div class="menu_button md-open-dict"><i class="fa-solid fa-book-open"></i> ${esc(t.openDict)}</div>
                <div class="menu_button md-open-cards"><i class="fa-solid fa-layer-group"></i> ${esc(t.openCards)}</div>
                <div class="menu_button md-preview"><i class="fa-solid fa-eye"></i> ${esc(t.preview)}</div>
            </div>
        </div></div>
    </div>`;
}

function refreshStats() {
    const st = stats();
    const t = T();
    const line = `${LANGS[S().target]?.flag || ''} 🔥 ${t.streak(S().stats.streak)} · ${t.words(st.total)} · ${st.known} ${t.known} · ${st.due} ${t.due}`;
    document.querySelectorAll('.md-stats-line').forEach(el => { el.textContent = line; });
    const badge = document.querySelector('#md_wand_cards .md-due');
    if (badge) badge.textContent = st.due ? String(st.due) : '';
}

function mountSettings() {
    let host = document.getElementById('md_settings');
    const wasOpen = host?.querySelector('.inline-drawer-content')?.style.display === 'block';
    if (!host) {
        host = document.createElement('div');
        host.id = 'md_settings';
        (document.getElementById('extensions_settings2') || document.getElementById('extensions_settings'))?.append(host);
    }
    host.innerHTML = settingsHtml();
    if (wasOpen) {
        host.querySelector('.inline-drawer-content').style.display = 'block';
        host.querySelector('.inline-drawer-icon')?.classList.replace('down', 'up');
        host.querySelector('.inline-drawer-icon')?.classList.replace('fa-circle-chevron-down', 'fa-circle-chevron-up');
    }

    host.querySelectorAll('[data-md]').forEach(input => {
        input.addEventListener('change', () => {
            const id = input.dataset.md;
            const s = S();
            s[id] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
            save();
            updatePrompt();
            if (id === 'native' || id === 'target') { mountSettings(); mountWand(); }
            if (id === 'display' || id === 'enabled' || id === 'target') rerenderAll();
            refreshStats();
        });
    });
    host.querySelector('.md-open-dict').addEventListener('click', openDictionary);
    host.querySelector('.md-open-cards').addEventListener('click', openCards);
    host.querySelector('.md-preview').addEventListener('click', () => {
        const c = ctx();
        const text = S().enabled ? buildPrompt() : T().disabled;
        c.callGenericPopup(`<pre class="md-preview-text">${esc(text)}</pre>`, c.POPUP_TYPE.TEXT, '', { wide: true });
    });
    refreshStats();
}

function mountWand() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;
    document.getElementById('md_wand_container')?.remove();
    const t = T();
    const box = document.createElement('div');
    box.id = 'md_wand_container';
    box.className = 'extension_container';
    box.innerHTML = `
        <div id="md_wand_dict" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-book-open extensionsMenuExtensionButton"></div>${esc(t.openDict)}
        </div>
        <div id="md_wand_cards" class="list-group-item flex-container flexGap5">
            <div class="fa-solid fa-layer-group extensionsMenuExtensionButton"></div>${esc(t.openCards)} <span class="md-due"></span>
        </div>`;
    menu.append(box);
    box.querySelector('#md_wand_dict').addEventListener('click', openDictionary);
    box.querySelector('#md_wand_cards').addEventListener('click', openCards);
    refreshStats();
}

/* ------------------------------------------------------- slash commands --- */

function registerCommands() {
    const c = ctx();
    if (!c.SlashCommandParser || !c.SlashCommand) return;
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = c;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'md-dict',
        callback: async () => { openDictionary(); return ''; },
        helpString: 'Mots Doux: open the dictionary.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'md-cards',
        callback: async () => { openCards(); return ''; },
        helpString: 'Mots Doux: review flashcards.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'md-level',
        callback: async (_args, value) => {
            const v = String(value || '').trim().toUpperCase();
            if (LEVELS[v]) {
                S().level = v; save(); updatePrompt(); mountSettings();
            }
            return S().level;
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({
            description: 'A0, A1, A2, B1, B2 or C1',
            typeList: [ARGUMENT_TYPE.STRING],
            isRequired: false,
        })],
        returns: 'current level',
        helpString: 'Mots Doux: show or set the level, e.g. <code>/md-level A2</code>.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'md-toggle',
        callback: async () => {
            S().enabled = !S().enabled; save(); updatePrompt(); mountSettings(); rerenderAll();
            toast(S().enabled ? T().on : T().off);
            return String(S().enabled);
        },
        helpString: 'Mots Doux: turn on or off.',
    }));
}

/* ---------------------------------------------------------------- init --- */

function init() {
    const c = ctx();
    const ev = c.eventTypes;
    S();

    mountSettings();
    mountWand();
    registerCommands();
    updatePrompt();

    document.getElementById('chat')?.addEventListener('click', onChatClick, true);
    document.addEventListener('click', e => {
        if (popover && !e.target.closest('.md-popover, .md-word, .md-fix')) closePopover();
    });
    document.getElementById('chat')?.addEventListener('scroll', closePopover, { passive: true });

    c.eventSource.on(ev.MESSAGE_RECEIVED, id => harvestMessage(id));
    c.eventSource.on(ev.CHARACTER_MESSAGE_RENDERED, id => renderMessage(id));
    c.eventSource.on(ev.USER_MESSAGE_RENDERED, id => renderMessage(id));
    for (const name of [ev.MESSAGE_UPDATED, ev.MESSAGE_EDITED, ev.MESSAGE_SWIPED]) {
        if (name) c.eventSource.on(name, id => setTimeout(() => renderMessage(id), 30));
    }
    for (const name of [ev.CHAT_CHANGED, ev.MORE_MESSAGES_LOADED, ev.CHAT_LOADED]) {
        if (name) c.eventSource.on(name, () => { renderAllSoon(); updatePrompt(); });
    }
    if (ev.GENERATION_AFTER_COMMANDS) c.eventSource.on(ev.GENERATION_AFTER_COMMANDS, updatePrompt);

    // Voices load asynchronously in some browsers.
    if ('speechSynthesis' in window) speechSynthesis.getVoices();

    renderAllSoon();
    console.log('[Mots Doux] ready');
}

jQuery(() => {
    try {
        init();
    } catch (e) {
        console.error('[Mots Doux] failed to start', e);
    }
});
