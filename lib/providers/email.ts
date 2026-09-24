import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailSender {
  send(input: { to: string; subject: string; text: string; html?: string; fromName?: string | null }): Promise<{ ok: boolean; messageId?: string; error?: string }>;
}

export class SmtpEmail implements EmailSender {
  private transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(input: { to: string; subject: string; text: string; html?: string; fromName?: string | null }) {
    try {
      const info = await this.transport.sendMail({
        from: input.fromName ? `"${input.fromName.replace(/"/g, '')}" <${this.from}>` : this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { ok: true, messageId: info.messageId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export class ConsoleEmail implements EmailSender {
  async send(input: { to: string; subject: string; text: string }) {
    console.log(`\n✉️  EMAIL -> ${input.to}\nSubject: ${input.subject}\n${input.text}\n`);
    return { ok: true, messageId: `console-${Date.now()}` };
  }
}
