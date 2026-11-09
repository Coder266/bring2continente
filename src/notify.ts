import type { Logger } from "./logger.js";

export interface NotifyInput {
  title: string;
  message: string;
  priority?: "min" | "low" | "default" | "high" | "urgent";
  tags?: string[];
  /** Opens this URL when the notification is tapped. */
  click?: string;
  actions?: Array<{ action: "view"; label: string; url: string; clear?: boolean }>;
}

export interface Notifier {
  send(input: NotifyInput): Promise<void>;
}

export class NoopNotifier implements Notifier {
  async send(): Promise<void> {}
}

export class NtfyNotifier implements Notifier {
  constructor(
    private readonly options: {
      url: string;
      topic: string;
      token?: string;
      publicUrl?: string;
      logger: Logger;
    },
  ) {}

  async send(input: NotifyInput): Promise<void> {
    if (!this.options.url) return;
    const actions = [
      ...(input.actions ?? []),
      ...(input.click
        ? [{ action: "view" as const, label: "Abrir", url: input.click, clear: false }]
        : []),
    ];
    try {
      const response = await fetch(this.options.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify({
          topic: this.options.topic,
          title: input.title,
          message: input.message,
          priority: input.priority ?? "default",
          tags: input.tags ?? [],
          ...(actions.length > 0 ? { actions } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        this.options.logger.warn(`ntfy returned ${response.status}`);
      }
    } catch (error) {
      this.options.logger.warn("Could not send ntfy notification", { error: String(error) });
    }
  }
}
