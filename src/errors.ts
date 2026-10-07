export type ErrorCode =
  | "EMPTY_INPUT"
  | "TOO_MANY_NOTES"
  | "INVALID_NOTE_TYPE"
  | "NOTE_OUT_OF_RANGE"
  | "NON_INTEGER_NOTE"
  | "MIDI_OUT_OF_RANGE_TRANSPOSE"
  | "NOT_FOUND"
  | "INVALID_BODY"
  | "BAD_REQUEST";

export class ValidationError extends Error {
  readonly code: ErrorCode;
  readonly status = 400;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code: ErrorCode;
  readonly status = 404;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "NotFoundError";
  }
}
