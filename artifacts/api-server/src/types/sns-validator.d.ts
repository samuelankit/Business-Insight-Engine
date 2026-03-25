declare module "sns-validator" {
  class MessageValidator {
    constructor(hostPattern?: RegExp, encoding?: string);
    validate(message: Record<string, unknown>, cb: (err: Error | null) => void): void;
  }
  export = MessageValidator;
}
