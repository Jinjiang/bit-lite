export class BitLiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitLiteError";
  }
}
