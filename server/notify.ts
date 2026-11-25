// Outbound Telegram messages go through here so tests can record them instead of
// sending to chats that don't exist. Production always uses the real Bot API.
import { send as tgSend } from './telegram.js';

type Button = { text: string; url?: string; callback_data?: string; web_app?: { url: string } };
export type Outgoing = { chatId: number | string; text: string; buttons?: Button[][] };
type Sender = (m: Outgoing) => Promise<unknown>;

let sender: Sender = (m) => tgSend(m.chatId, m.text, m.buttons);

export function setSender(fn: Sender) {
  sender = fn;
}

export const notify = (chatId: number | string, text: string, buttons?: Button[][]) =>
  sender({ chatId, text, buttons });
