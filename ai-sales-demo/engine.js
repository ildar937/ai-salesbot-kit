/**
 * engine.js — движок маршрутизации "ИИ-продажника" (демо-режим).
 *
 * Это не вызов настоящей языковой модели — это детерминированный правило-движок
 * на чистых функциях, который имитирует поведение, описанное в задании
 * (discovery / product-match / objections / lead-capture / human-handoff / quality-check).
 * Он используется и в браузерной демке (index.html), и в тестах (tests.js) —
 * один и тот же код, чтобы демо и тесты не расходились.
 *
 * Для настоящей версии эти функции заменяются на вызов реального провайдера
 * (ключ только на сервере), а сами тексты из skills/*.md передаются модели
 * как системные инструкции конкретного навыка.
 */

'use strict';

// ---------- утилиты ----------

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(s, maxLen) {
  if (typeof s !== 'string') return '';
  // убираем управляющие символы, режем длину — "входные данные недоверенные"
  let out = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (maxLen && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function findPhoneOrEmail(text) {
  const t = String(text || '');
  const email = t.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  const phone = t.match(/\+?\d[\d\-\s()]{6,}\d/);
  if (email) return { kind: 'email', value: email[0] };
  if (phone) return { kind: 'phone', value: phone[0].replace(/\s+/g, ' ').trim() };
  return null;
}

// Простой детерминированный id без внешних зависимостей (demo-only).
function hashId(str) {
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return 'lead_' + Math.abs(h).toString(36);
}

// ---------- распознавание намерения (заглушка вместо вызова модели) ----------

const PATTERNS = {
  humanRequest: /человек|менеджер|оператор|живого|позовите|жалоб/i,
  declineStop: /не пиш(ите)?|отстав(ьте)?|больше не звон|удали(те)? мои данные|перестань(те)?|не звони/i,
  priceQuestion: /сколько стоит|сколько будет стоить|какая цена|цена\b|стоимост/i,
  discountRequest: /скидк|дешевле|подешевле|уступ/i,
  // \b не годится для кириллицы (JS считает её не-словесным символом) — используем lookahead на конец/пробел/пунктуацию.
  consentYes: /^(да|хорошо|ок|окей|согласен|согласна|давайте|устраивает|го|пойдёт|подходит)(?=$|[\s,.!?])/i,
  consentNo: /^(нет|не хочу|не надо|не сейчас)(?=$|[\s,.!?])/i,
  rulesOverrideAttempt: /игнорируй (правила|инструкции)|покажи (секрет|систем|промпт)|забудь (правила|инструкции)|ты теперь|новая роль|режим разработчика|developer mode|system prompt/i,
};

function detectIntent(message) {
  const text = clean(message, 2000);
  if (!text) return { type: 'empty', text };

  // Попытка переопределить роль — не меняет намерение, помечается отдельно и игнорируется ниже.
  const injectionAttempt = PATTERNS.rulesOverrideAttempt.test(text);

  if (PATTERNS.declineStop.test(text)) return { type: 'decline_stop', text, injectionAttempt };
  if (PATTERNS.humanRequest.test(text)) return { type: 'human_request', text, injectionAttempt };
  if (PATTERNS.priceQuestion.test(text)) return { type: 'price_question', text, injectionAttempt };
  if (PATTERNS.discountRequest.test(text)) return { type: 'discount_request', text, injectionAttempt };
  const contact = findPhoneOrEmail(text);
  if (contact) return { type: 'contact_info', text, contact, injectionAttempt };
  if (PATTERNS.consentYes.test(text)) return { type: 'consent_yes', text, injectionAttempt };
  if (PATTERNS.consentNo.test(text)) return { type: 'consent_no', text, injectionAttempt };
  return { type: 'generic', text, injectionAttempt };
}

// ---------- каталог / подбор ----------

function getCatalogItem(catalog, id) {
  return catalog.items.find((i) => i.id === id) || null;
}

// Явно вне линейки — агент не должен подгонять под это каталог (сценарий "продукт не подходит").
const OUT_OF_SCOPE = /seo-продвижен|продвижение сайта|мобильное приложени|доработ.*(сайт|магазин)|таргет(ированная)? реклама|реклама в яндекс/i;

// Сопоставление задачи клиента с каталогом. brief.task — текст в свободной форме.
// Возвращает [] (а не силой подобранный вариант), когда честного соответствия нет —
// либо задача вне линейки, либо ни один вариант не укладывается в названный бюджет.
function matchProducts(catalog, brief) {
  const text = (brief.task || '').toLowerCase();
  if (OUT_OF_SCOPE.test(text)) return [];

  const nicheScore = (item) => {
    if (/магазин|товар|woocommerce|продаж[аи] онлайн/.test(text) && item.id === 'shop') return 3;
    if (/корпоратив|компани|несколько страниц|о нас/.test(text) && item.id === 'corporate') return 3;
    if (/лендинг|визитк|одна страница|быстро/.test(text) && item.id === 'landing') return 3;
    return 0;
  };

  let candidates = catalog.items.map((item) => ({ item, score: nicheScore(item) }));
  const hasNicheSignal = candidates.some((c) => c.score > 0);
  if (hasNicheSignal) candidates = candidates.filter((c) => c.score > 0);

  if (brief.budget != null) {
    const affordable = candidates.filter((c) => c.item.price <= brief.budget);
    if (affordable.length === 0) return []; // честно: ни один вариант не укладывается в бюджет
    candidates = affordable;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3).map((c) => c.item);
}

// Детерминированный расчёт — цена ТОЛЬКО из каталога, не из текста модели.
function priceLine(item, catalog) {
  return `${item.name}: ${item.price} ${catalog.currency === 'RUB' ? '₽' : catalog.currency} (${item.period}), срок — ${item.timeline}. Источник: прайс ${catalog.version}.`;
}

// Проверка конфликта цены по двум версиям каталога для одного товара (сценарий 4).
function checkPriceConflict(catalogA, catalogB, itemId) {
  const a = getCatalogItem(catalogA, itemId);
  const b = getCatalogItem(catalogB, itemId);
  if (!a || !b) return { conflict: false };
  if (a.price !== b.price) {
    return {
      conflict: true,
      reason: `цена товара "${itemId}" различается между источниками (${catalogA.version}: ${a.price}; ${catalogB.version}: ${b.price})`,
    };
  }
  return { conflict: false };
}

// ---------- состояние диалога ----------

function createConversation(conversationId, ownerId) {
  return {
    id: conversationId,
    ownerId: ownerId || conversationId,
    state: 'new', // new, discovery, offer, consent_pending, lead_draft, human_pending, closed
    brief: { task: null, budget: null, deadline: null },
    offeredProductId: null,
    consentStatus: 'none', // none, requested, given, declined
    lead: null,
    stopped: false,
    closedReason: null,
    askedDiscount: false,
    log: [],
  };
}

function logStep(conv, note) {
  conv.log.push({ t: Date.now(), note });
}

// Выдача заявки из хранилища только владельцу диалога (сценарий 12 — изоляция).
function getConversationForRequester(store, requesterId, conversationId) {
  const conv = store.get(conversationId);
  if (!conv) return { ok: false, reason: 'not_found' };
  if (conv.ownerId !== requesterId) return { ok: false, reason: 'forbidden' };
  return { ok: true, conv };
}

// ---------- навыки ----------

function skillDiscovery(conv, intent) {
  if (!conv.brief.task) {
    conv.brief.task = intent.text;
  }
  conv.state = 'discovery';
  logStep(conv, 'discovery: собран бриф');
  return {
    reply:
      'Подскажите, пожалуйста, какой сайт нужен: сайт-визитка на одну страницу, несколько страниц о компании, или интернет-магазин с товарами?',
    next_state: 'discovery',
  };
}

function skillProductMatch(conv, catalog) {
  const matches = matchProducts(catalog, conv.brief);
  if (!matches.length) {
    conv.state = 'human_pending';
    logStep(conv, 'product-match: подходящего варианта не нашлось, передача человеку');
    return {
      reply: 'Под такую задачу готового варианта в текущей линейке нет — передам менеджеру, чтобы предложил индивидуальное решение.',
      next_state: 'human_pending',
      proposed_action: 'human_handoff',
    };
  }
  conv.offeredProductId = matches[0].id;
  conv.state = 'offer';
  const lines = matches.map((m) => `• ${priceLine(m, catalog)}`).join('\n');
  logStep(conv, `product-match: предложено ${matches.map((m) => m.id).join(', ')}`);
  return {
    reply: `Вот подходящие варианты:\n${lines}\n\nПередать заявку менеджеру, чтобы согласовать детали и сроки?`,
    next_state: 'offer',
    facts_used: matches.map((m) => m.id),
  };
}

function skillObjections(conv, intent, catalog) {
  if (intent.type === 'discount_request') {
    conv.askedDiscount = true;
    logStep(conv, 'objections: запрос скидки без полномочий — отказ без самовольной скидки');
    return {
      reply:
        'Скидку без согласования дать не могу — цена в прайсе актуальная и единая для всех. Если условия важны, могу передать вопрос менеджеру.',
      next_state: conv.state,
    };
  }
  logStep(conv, 'objections: обработано сомнение');
  return {
    reply:
      'Понимаю сомнение. Цена и состав — из актуального прайса, без скрытых доплат. Если нужно — могу сравнить варианты подробнее или передать вопрос менеджеру.',
    next_state: conv.state,
  };
}

function skillLeadCapture(conv, catalog, store, contact, idempotencyKey) {
  const key = idempotencyKey || hashId(conv.id);
  if (conv.lead && conv.lead.idempotency_key === key) {
    logStep(conv, 'lead-capture: повтор операции — возвращён прежний id');
    return { reply: `Заявка уже оформлена (№ ${conv.lead.lead_id}). Менеджер свяжется по указанному контакту.`, lead: conv.lead, duplicate: true };
  }
  const product = getCatalogItem(catalog, conv.offeredProductId);
  const lead = {
    lead_id: hashId(key),
    conversation_id: conv.id,
    idempotency_key: key,
    contact: contact ? contact.value : null,
    contact_kind: contact ? contact.kind : null,
    consent_status: 'given',
    consent_time: Date.now(),
    need: conv.brief.task,
    product_id: product ? product.id : 'unknown',
    next_step: 'передача менеджеру',
    delivery_status: 'demo', // в демо-режиме реальная отправка не выполняется
  };
  conv.lead = lead;
  conv.state = 'lead_draft';
  conv.consentStatus = 'given';
  logStep(conv, `lead-capture: создана заявка ${lead.lead_id}`);
  return {
    reply: `Заявка оформлена (№ ${lead.lead_id}). В демо-режиме реальная отправка менеджеру не выполняется — это заглушка.`,
    lead,
    duplicate: false,
  };
}

function skillHumanHandoff(conv, reason) {
  const wasAlreadyPending = conv.state === 'human_pending';
  conv.state = 'human_pending';
  conv.stopped = false; // human_pending останавливает автопродажу, но не кнопку "стоп" пользователя
  logStep(conv, `human-handoff: ${reason}`);
  return {
    reply: wasAlreadyPending
      ? 'Диалог уже передан менеджеру, новых автоматических предложений не будет.'
      : 'Передаю менеджеру: он свяжется и разберётся в вопросе. Автоматические предложения по этому диалогу останавливаю.',
    next_state: 'human_pending',
    proposed_action: 'human_handoff',
    reason,
  };
}

// Контроль ответа перед отправкой (сценарии "конфликт цен", "не выдумывать").
function qualityCheck({ replyFacts, catalog, extraCatalogVersion }) {
  const violations = [];
  if (extraCatalogVersion) {
    for (const id of replyFacts || []) {
      const c = checkPriceConflict(catalog, extraCatalogVersion, id);
      if (c.conflict) violations.push(c.reason);
    }
  }
  if (violations.length) {
    return { verdict: 'human_review', violations };
  }
  return { verdict: 'pass', violations: [] };
}

// ---------- роутер ----------

function route(conv, catalog, rawMessage, opts) {
  opts = opts || {};
  if (conv.stopped) {
    return { reply: 'Автоматические ответы для этого диалога остановлены.', next_state: conv.state, stopped: true };
  }
  const intent = detectIntent(rawMessage);

  if (intent.type === 'empty') {
    return { reply: 'Не увидел текста сообщения — напишите, пожалуйста, вопрос ещё раз.', next_state: conv.state };
  }

  // Попытка переопределить правила через текст клиента — не меняет роль, просто продолжаем штатно.
  // (намеренно не делаем ничего особого: правила агента не читаются из сообщений клиента)

  if (intent.type === 'decline_stop') {
    conv.state = 'closed';
    conv.closedReason = 'client_declined';
    conv.stopped = true;
    logStep(conv, 'router: клиент попросил не писать — диалог закрыт, повторные продажи не запускаются');
    return { reply: 'Хорошо, больше не буду писать по этому вопросу.', next_state: 'closed' };
  }

  if (intent.type === 'human_request') {
    return skillHumanHandoff(conv, 'запрос клиента на человека');
  }

  if (conv.state === 'human_pending') {
    return { reply: 'Диалог передан менеджеру — дождитесь ответа, автоматические предложения приостановлены.', next_state: 'human_pending' };
  }

  if (conv.state === 'closed') {
    return { reply: 'Диалог закрыт. Если нужно обсудить что-то новое — напишите, пожалуйста, отдельно.', next_state: 'closed' };
  }

  // Прямой вопрос о цене отвечаем сразу, даже первым сообщением, без требования телефона.
  if (intent.type === 'price_question') {
    if (!conv.brief.task) conv.brief.task = intent.text;
    const r = skillProductMatch(conv, catalog);
    return r;
  }

  if (intent.type === 'discount_request') {
    return skillObjections(conv, intent, catalog);
  }

  if (intent.type === 'contact_info') {
    if (conv.state === 'offer' || conv.state === 'consent_pending') {
      const res = skillLeadCapture(conv, catalog, opts.store, intent.contact, opts.idempotencyKey);
      return res;
    }
    // контакт дали раньше, чем согласились на передачу — не запрашиваем его повторно,
    // но и не создаём заявку без согласованного следующего шага
    return {
      reply: 'Спасибо, контакт вижу. Сначала уточним вариант сайта, а затем оформим заявку с этим контактом.',
      next_state: conv.state,
    };
  }

  if (intent.type === 'consent_no') {
    if (conv.state === 'offer' || conv.state === 'consent_pending') {
      conv.consentStatus = 'declined';
      logStep(conv, 'router: клиент отказался оставлять контакт — данные не запрашиваются повторно');
      return { reply: 'Хорошо, контакт не нужен. Если понадобится — дайте знать.', next_state: conv.state };
    }
  }

  if (intent.type === 'consent_yes') {
    if (conv.state === 'offer') {
      conv.state = 'consent_pending';
      conv.consentStatus = 'requested';
      logStep(conv, 'router: согласие на передачу — запрашиваем контакт');
      return { reply: 'Отлично. Оставьте, пожалуйста, телефон или e-mail — на него менеджер выйдет на связь.', next_state: 'consent_pending' };
    }
    if (conv.state === 'new' || conv.state === 'discovery') {
      return skillDiscovery(conv, intent);
    }
  }

  // generic
  if (conv.state === 'new') {
    return skillDiscovery(conv, intent);
  }
  if (conv.state === 'discovery') {
    // если в брифе уже достаточно — переходим к подбору
    conv.brief.task = conv.brief.task || intent.text;
    return skillProductMatch(conv, catalog);
  }
  if (conv.state === 'offer' || conv.state === 'consent_pending') {
    return skillObjections(conv, intent, catalog);
  }

  return { reply: 'Уточните, пожалуйста, вопрос — я по профилю сайтов и их стоимости.', next_state: conv.state };
}

// Обёртка для имитации вызова модели с таймаутом/ошибкой (сценарий 13).
async function callWithFallback(fn, { retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  return {
    reply: 'Сейчас не получилось обработать запрос из-за технического сбоя. Попробуйте ещё раз чуть позже, либо попросите позвать менеджера.',
    error: true,
    detail: String((lastErr && lastErr.message) || lastErr),
  };
}

const api = {
  esc,
  clean,
  findPhoneOrEmail,
  hashId,
  detectIntent,
  getCatalogItem,
  matchProducts,
  priceLine,
  checkPriceConflict,
  createConversation,
  logStep,
  getConversationForRequester,
  skillDiscovery,
  skillProductMatch,
  skillObjections,
  skillLeadCapture,
  skillHumanHandoff,
  qualityCheck,
  route,
  callWithFallback,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.SalesEngine = api;
}
