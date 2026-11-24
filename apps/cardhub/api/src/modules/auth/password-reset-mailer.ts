import { readMailConfig } from './mail.config';

export type PasswordResetMail = {
  to: string;
  token: string;
  expiresAt: Date;
};

export type PasswordResetMailer = {
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
};

type EnvMap = Readonly<Record<string, string | undefined>>;

const memoryMails: PasswordResetMail[] = [];

/** Test-only mailbox used when MAIL_PROVIDER=memory and NODE_ENV=test. */
export function memoryPasswordResetMails(): readonly PasswordResetMail[] {
  return memoryMails;
}

export function clearMemoryPasswordResetMails(): void {
  memoryMails.length = 0;
}

export async function sendPasswordResetToMemory(mail: PasswordResetMail): Promise<void> {
  memoryMails.push(mail);
}

/** Injected mailer wins. Otherwise only the test memory provider can send. */
export function resolvePasswordResetMailer(
  env: EnvMap,
  override?: PasswordResetMailer,
): PasswordResetMailer | undefined {
  if (override) return override;
  const config = readMailConfig(env);
  if (config?.provider === 'memory') {
    return { sendPasswordReset: sendPasswordResetToMemory };
  }
  return undefined;
}
