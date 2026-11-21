import {
  ButtonsMessage,
  DownloadOutcome,
  MessageTemplate,
  NewTemplate,
  SendOutcome,
  TemplateWriteOutcome,
  TemplatesOutcome,
  TemplateMessage,
  SampleUploadOutcome,
  UploadOutcome,
  WhatsappClient,
} from '../whatsapp.client';

export type FakeSent =
  | { type: 'template'; to: string; template: TemplateMessage; id: string }
  | { type: 'image'; to: string; mediaId: string; caption: string; id: string }
  | { type: 'text'; to: string; body: string; id: string }
  | { type: 'buttons'; to: string; message: ButtonsMessage; id: string }
  | {
      type: 'document';
      to: string;
      mediaId: string;
      fileName: string;
      caption?: string;
      id: string;
    };

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

  /** Sample images uploaded for template headers. */
  samples: Buffer[] = [];

  uploadTemplateSample(png: Buffer): Promise<SampleUploadOutcome> {
    this.samples.push(png);
    return Promise.resolve({
      ok: true,
      handle: `4::sample${this.samples.length}`,
    });
  }

  uploadPng(png: Buffer): Promise<UploadOutcome> {
    return this.uploadMedia(png);
  }

  /** Makes the next upload fail. */
  nextUploadFailure: Exclude<UploadOutcome, { ok: true }> | null = null;

  uploadMedia(data: Buffer): Promise<UploadOutcome> {
    if (this.nextUploadFailure) {
      const failure = this.nextUploadFailure;
      this.nextUploadFailure = null;
      return Promise.resolve(failure);
    }
    this.uploads.push(data);
    return Promise.resolve({
      ok: true,
      mediaId: `media_${this.uploads.length}`,
    });
  }

  /** Meta's media by id; a missing id answers like Meta's 404 (`meta_100`, not retried). */
  media = new Map<string, { data: Buffer; mimeType: string }>();
  /** Makes the next download answer this instead. */
  nextDownload: DownloadOutcome | null = null;
  downloads: string[] = [];

  downloadMedia(mediaId: string, maxBytes: number): Promise<DownloadOutcome> {
    this.downloads.push(mediaId);
    if (this.nextDownload) {
      const outcome = this.nextDownload;
      this.nextDownload = null;
      return Promise.resolve(outcome);
    }
    const file = this.media.get(mediaId);
    if (!file)
      return Promise.resolve({
        ok: false,
        tooLarge: false,
        retry: false,
        code: 'meta_100',
      });
    if (file.data.length > maxBytes)
      return Promise.resolve({
        ok: false,
        tooLarge: true,
        size: file.data.length,
        mimeType: file.mimeType,
      });
    return Promise.resolve({ ok: true, ...file });
  }

  sendDocument(
    to: string,
    mediaId: string,
    fileName: string,
    caption?: string,
  ): Promise<SendOutcome> {
    return this.accept((id) => ({
      type: 'document',
      to,
      mediaId,
      fileName,
      caption,
      id,
    }));
  }

  reset(): void {
    this.templates = [];
    this.templatesError = null;
    this.created = [];
    this.deleted = [];
    this.nextWriteFailure = null;
    this.sent = [];
    this.uploads = [];
    this.samples = [];
    this.nextOutcome = null;
    this.nextUploadFailure = null;
    this.media.clear();
    this.nextDownload = null;
    this.downloads = [];
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
