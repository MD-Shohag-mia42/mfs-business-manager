import { parseAmount, findDateTime, cleanRef, firstMatch } from './helpers.js';
import { normalizeBdMobile } from '../utils/phone.js';

const TK = String.raw`(?:Tk\.?|BDT|৳)`;
const NUM = String.raw`([\d,]+(?:\.\d+)?)`;

// Nagad: "Money Received.\nAmount: Tk 2030.00\nSender: 01XXXXXXXXX\nRef: N/A\n
//         TxnID: XXXXXXXX\nBalance: Tk 2031.23\n22/11/2026 14:01"
export const nagadReceivedV1 = {
  id: 'nagad-received-v1',
  service: 'nagad',
  type: 'received',
  label: 'Nagad · Received Money',
  startMarker: /Money\s+Received\b/gi,

  detect(text) {
    return /^\s*Money\s+Received\b/i.test(text);
  },

  parse(text) {
    const sender = firstMatch(text, /\bSender\s*[:：-]?\s*(\+?\d(?:[\s-]?\d){9,13})/i);
    return {
      amount: parseAmount(firstMatch(text, new RegExp(String.raw`\bAmount\s*[:：-]?\s*${TK}?\s*${NUM}`, 'i'))),
      sender_number: sender ? normalizeBdMobile(sender) : null,
      fee: parseAmount(firstMatch(text, new RegExp(String.raw`\bFee\s*[:：-]?\s*${TK}?\s*${NUM}`, 'i'))),
      reference: cleanRef(firstMatch(text, /^\s*Ref(?:erence)?\s*[:：-]?\s*(.*)$/im)),
      balance_after: parseAmount(
        firstMatch(text, new RegExp(String.raw`\bBalance\s*[:：-]?\s*${TK}?\s*${NUM}`, 'i'))
      ),
      trx_id: firstMatch(text, /\bT(?:xn|rx)\s?ID\s*[:：-]?\s*([A-Za-z0-9]{6,20})/i)?.toUpperCase() ?? null,
      datetime: findDateTime(text),
    };
  },
};
