export class DomainError extends Error {
  constructor(message, code = 'VALIDATION') {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}