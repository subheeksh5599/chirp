// Required configuration. Every missing value fails loudly with its name, never silently.
const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new HttpError(500, `server is missing ${name}`);
  return v;
};

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const env = {
  get databaseUrl() {
    return need('DATABASE_URL');
  },
  get botToken() {
    return need('TELEGRAM_BOT_TOKEN');
  },
  get webhookSecret() {
    return need('TELEGRAM_WEBHOOK_SECRET');
  },
  get groqKey() {
    return need('GROQ_API_KEY');
  },
  /** Organiser / shop wallet that receives testnet anchors and payments. */
  get tonAddress() {
    return need('TON_WALLET_ADDRESS');
  },
  /** ed25519 private key (PKCS8, base64) that signs presence records. */
  get presenceKey() {
    return need('PRESENCE_SIGNING_KEY');
  },
  get publicUrl() {
    return need('PUBLIC_URL').replace(/\/$/, '');
  },
  get schema() {
    return process.env.DB_SCHEMA || 'public';
  },
  /** Optional: toncenter API key raises the free rate limit. */
  get toncenterKey() {
    return process.env.TONCENTER_API_KEY || '';
  },
};
