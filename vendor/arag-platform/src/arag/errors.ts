/** Error raised by the ARAG client. Uses explicit fields (erasable TypeScript syntax only). */
export type AragErrorKind = "timeout" | "http" | "network" | "aborted" | "protocol";

export class AragError extends Error {
  readonly kind: AragErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;
  readonly operation: string;

  constructor(message: string, kind: AragErrorKind, operation: string, status?: number, detail?: string) {
    super(message);
    this.name = "AragError";
    this.kind = kind;
    this.operation = operation;
    this.status = status;
    this.detail = detail;
  }

  /** True for errors that are safe to retry (network/timeouts/5xx/429). */
  get retryable(): boolean {
    if (this.kind === "network" || this.kind === "timeout") return true;
    if (this.kind === "http" && this.status !== undefined) return this.status === 429 || this.status >= 500;
    return false;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      kind: this.kind,
      operation: this.operation,
      status: this.status,
    };
  }
}
