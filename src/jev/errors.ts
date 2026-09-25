export type JevErrorType =
  | 'invalid_request'
  | 'authentication_error'
  | 'not_found'
  | 'overloaded'
  | 'internal_error';

export interface JevErrorBody {
  message: string;
  error_type: JevErrorType;
}

export class JevError extends Error {
  constructor(
    readonly status: number,
    readonly errorType: JevErrorType,
    message: string,
  ) {
    super(message);
    this.name = 'JevError';
  }

  toBody(): JevErrorBody {
    return { message: this.message, error_type: this.errorType };
  }

  static invalid(message: string): JevError {
    return new JevError(422, 'invalid_request', message);
  }
}
