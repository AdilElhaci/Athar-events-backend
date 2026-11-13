import {
  ButtonsMessage,
  MessageTemplate,
  NewTemplate,
  SendOutcome,
  TemplateWriteOutcome,
  TemplatesOutcome,
  TemplateMessage,
  UploadOutcome,
  WhatsappClient,
} from '../whatsapp.client';

export type FakeSent =
  | { type: 'template'; to: string; template: TemplateMessage; id: string }
  | { type: 'image'; to: string; mediaId: string; caption: string; id: string }
  | { type: 'text'; to: string; body: string; id: string }
  | { type: 'buttons'; to: string; message: ButtonsMessage; id: string };

/**
 * In-memory Meta for tests. Every accepted message gets a `wamid.test.<n>` id; set `nextOutcome`
 * to make the next send fail, need a retry or end up unknown.
 */
export class FakeWhatsappClient extends WhatsappClient {
  sent: FakeSent[] = [];
  uploads: Buffer[] = [];
  configured = true;
  nextOutcome: Exclude<SendOutcome, { outcome: 'SENT' }> | null = null;
  private sequence = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  /** What Meta returns for the WABA; set `templatesError` to make the read fail. */
  templates: MessageTemplate[] = [];
  templatesError: string | null = null;

  canListTemplates(): boolean {
    return this.configured;
  }

  listTemplates(): Promise<TemplatesOutcome> {
    if (this.templatesError)
      return Promise.resolve({ ok: false, code: this.templatesError });
    return Promise.resolve({ ok: true, templates: [...this.templates] });
  }

  /** Templates submitted through `createTemplate`, in order. */
  created: NewTemplate[] = [];
  deleted: Array<{ id: string; name: string }> = [];
  /** Makes the next create or delete fail. */
  nextWriteFailure: Exclude<TemplateWriteOutcome, { ok: true }> | null = null;

  createTemplate(template: NewTemplate): Promise<TemplateWriteOutcome> {
    const failure = this.takeWriteFailure();
    if (failure) return Promise.resolve(failure);
    const id = String(900000 + this.created.length + 1);
    this.created.push(template);
    this.templates.push({
      id,
      name: template.name,
      language: template.language,
      category: template.category,
      status: 'PENDING',
      rejectedReason: null,
      body: template.body,
      buttons: template.quickReplies,
    });
    return Promise.resolve({ ok: true, id, status: 'PENDING' });
  }

  deleteTemplate(id: string, name: string): Promise<TemplateWriteOutcome> {
    const failure = this.takeWriteFailure();
    if (failure) return Promise.resolve(failure);
    this.deleted.push({ id, name });
    this.templates = this.templates.filter((t) => t.id !== id);
    return Promise.resolve({ ok: true, id, status: '' });
  }

  private takeWriteFailure() {
    const failure = this.nextWriteFailure;
    this.nextWriteFailure = null;
    return failure;
  }

  sendTemplate(to: string, template: TemplateMessage): Promise<SendOutcome> {
    return this.accept((id) => ({ type: 'template', to, template, id }));
  }

  sendImage(
    to: string,
    mediaId: string,
    caption: string,
  ): Promise<SendOutcome> {
    return this.accept((id) => ({ type: 'image', to, mediaId, caption, id }));
  }

  sendText(to: string, body: string): Promise<SendOutcome> {
    return this.accept((id) => ({ type: 'text', to, body, id }));
  }

  sendButtons(to: string, message: ButtonsMessage): Promise<SendOutcome> {
    return this.accept((id) => ({ type: 'buttons', to, message, id }));
  }

  uploadPng(png: Buffer): Promise<UploadOutcome> {
    this.uploads.push(png);
    return Promise.resolve({
      ok: true,
      mediaId: `media_${this.uploads.length}`,
    });
  }

  reset(): void {
    this.templates = [];
    this.templatesError = null;
    this.created = [];
    this.deleted = [];
    this.nextWriteFailure = null;
    this.sent = [];
    this.uploads = [];
    this.nextOutcome = null;
  }

  private accept(build: (id: string) => FakeSent): Promise<SendOutcome> {
    if (this.nextOutcome) {
      const outcome = this.nextOutcome;
      this.nextOutcome = null;
      return Promise.resolve(outcome);
    }
    const id = `wamid.test.${++this.sequence}`;
    this.sent.push(build(id));
    return Promise.resolve({ outcome: 'SENT', messageId: id });
  }
}
