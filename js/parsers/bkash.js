import { parseAmount, findDateTime, cleanRef, firstMatch } from './helpers.js';
import { normalizeBdMobile } from '../utils/phone.js';

const TK = String.raw`(?:Tk\.?|BDT|৳)`;
const NUM = String.raw`([\d,]+(?:\.\d+)?)`;

// bKash: "You have received Tk 980.00 from 01XXXXXXXXX. Ref 1. Fee Tk 0.00.
//         Balance Tk 2,565.00. TrxID XXXXXXXXXX at 23/11/2026 03:51"
export const bkashReceivedV1 = {
  id: 'bkash-received-v1',
  service: 'bkash',
  type: 'received',
  label: 'bKash · Received Money',
  startMarker: new RegExp(String.raw`You\s+have\s+received\s+${TK}`, 'gi'),

  detect(text) {
    return new RegExp(String.raw`You\s+have\s+received\s+${TK}\s*\d`, 'i').test(text);
  },

  parse(text) {
    const sender = firstMatch(text, /\bfrom\s+(\+?\d(?:[\s-]?\d){9,13})/i);
    return {
      amount: parseAmount(firstMatch(text, new RegExp(String.raw`received\s+${TK}\s*${NUM}`, 'i'))),
      sender_number: sender ? normalizeBdMobile(sender) : null,
      fee: parseAmount(firstMatch(text, new RegExp(String.raw`\bFee\s*:?\s*${TK}?\s*${NUM}`, 'i'))),
      reference: cleanRef(firstMatch(text, /\bRef(?:erence)?\.?\s*:?\s*([^.\n]*)\./i)),
      balance_after: parseAmount(
        firstMatch(text, new RegExp(String.raw`\bBalance\s*:?\s*${TK}?\s*${NUM}`, 'i'))
      ),
      trx_id: firstMatch(text, /\bTrx\s?ID\s*:?\s*([A-Za-z0-9]{6,20})/i)?.toUpperCase() ?? null,
      datetime: findDateTime(text),
    };
  },
};
