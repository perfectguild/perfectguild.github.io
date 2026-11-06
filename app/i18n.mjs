import ru from './locales/ru.mjs';

// Register a future locale by importing its catalog and adding it here.
// Rendering uses message keys only; no parallel translated templates are needed.
const catalogs = new Map([[ru.locale, ru]]);
export const locale = 'ru';
const catalog = catalogs.get(locale);
const numberFormatter = new Intl.NumberFormat(catalog.intlLocale);
const dateFormatter = new Intl.DateTimeFormat(catalog.intlLocale, {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

export function t(key, params = {}) {
  const message = catalog.messages[key];
  if (typeof message !== 'string') {
    throw new RangeError(catalog.messages['errors.messageKey'].replace('{key}', key));
  }
  return message.replace(/\{(\w+)\}/g, (token, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : token
  ));
}

export function formatNumber(number) {
  return numberFormatter.format(number);
}

export function formatDate(isoDate) {
  return dateFormatter.format(new Date(isoDate));
}

const localizedAttributes = [
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-title', 'title'],
  ['data-i18n-alt', 'alt'],
];
const selector = '[data-i18n], [data-i18n-aria-label], [data-i18n-title], [data-i18n-alt]';

function localizeElement(element) {
  const textKey = element.getAttribute('data-i18n');
  if (textKey) element.textContent = t(textKey);
  for (const [source, attribute] of localizedAttributes) {
    const key = element.getAttribute(source);
    if (key) element.setAttribute(attribute, t(key));
  }
}

// These attributes take catalog keys, not translated strings. Dynamic messages
// with parameters use t(key, params) and textContent/setAttribute directly.
export function localizeDocument(root = document) {
  const ownerDocument = root.nodeType === 9 ? root : root.ownerDocument;
  if (ownerDocument) ownerDocument.documentElement.lang = locale;
  if (root.nodeType === 1 && root.matches(selector)) localizeElement(root);
  for (const element of root.querySelectorAll(selector)) localizeElement(element);
}
