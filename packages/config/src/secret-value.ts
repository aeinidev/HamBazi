// Explicit reveal at the infrastructure adapter boundary; serialization stays redacted.
export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  reveal(): string {
    return this.#value;
  }
  toString(): string {
    return "[REDACTED]";
  }
  toJSON(): string {
    return "[REDACTED]";
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[REDACTED]";
  }
}
