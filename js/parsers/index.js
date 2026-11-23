import { normalizeSmsText } from './helpers.js';
import { bkashReceivedV1 } from './bkash.js';
import { nagadReceivedV1 } from './nagad.js';

// To support a new SMS format: create a template file like bkash.js
// (id, service, type, startMarker, detect, parse) and add it here.
export const TEMPLATES = [bkashReceivedV1, nagadReceivedV1];

const EMPTY_FIELDS = {
  amount: null,
  sender_number: null,
  trx_id: null,
  datetime: null,
  balance_after: null,
  fee: null,
  reference: null,
};

// Splits one pasted text into separate SMS messages.
export function splitMessages(input) {
  const text = normalizeSmsText(input);
  if (!text) return [];

  const starts = new Set();
  for (const tpl of TEMPLATES) {
    for (const m of text.matchAll(tpl.startMarker)) starts.add(m.index);
  }
  const idx = [...starts].sort((a, b) => a - b);

  const blocks = (s) =>
    s
      .split(/\n\s*\n/)
      .map((x) => x.trim())
      .filter(Boolean);

  if (!idx.length) return blocks(text);

  const chunks = [];
  const head = text.slice(0, idx[0]).trim();
  if (head.length >= 25) chunks.push(...blocks(head)); // unknown text before first SMS
  idx.forEach((start, i) => {
    chunks.push(text.slice(start, idx[i + 1] ?? text.length).trim());
  });
  return chunks.filter(Boolean);
}

export function parseMessage(raw) {
  const text = normalizeSmsText(raw);
  const tpl = TEMPLATES.find((t) => t.detect(text));

  if (!tpl) {
    return { recognized: false, templateId: null, service: null, type: null, fields: { ...EMPTY_FIELDS }, found: [], raw: text };
  }

  const parsed = tpl.parse(text);
  const found = Object.keys(parsed).filter((k) => parsed[k] !== null && parsed[k] !== undefined);
  return {
    recognized: true,
    templateId: tpl.id,
    service: tpl.service,
    type: tpl.type,
    fields: { ...EMPTY_FIELDS, ...parsed },
    found,
    raw: text,
  };
}

export function parseSms(input) {
  return splitMessages(input).map(parseMessage);
}
