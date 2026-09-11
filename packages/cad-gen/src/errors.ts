/** Error hierarchy for @arbesk/cad-gen. */
export class CadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CadError";
  }
}

/** The model returned a malformed design document. */
export class CadDesignError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadDesignError";
  }
}

/** Generated code failed the static guard. */
export class CadGuardError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadGuardError";
  }
}

/** The kernel failed to execute generated code. */
export class CadKernelError extends CadError {
  constructor(message: string) {
    super(message);
    this.name = "CadKernelError";
  }
}

/** Every repair attempt failed; carries the attempt log for diagnostics. */
export class CadGenerationFailed extends CadError {
  readonly diagnostics: unknown;
  constructor(message: string, diagnostics: unknown) {
    super(message);
    this.name = "CadGenerationFailed";
    this.diagnostics = diagnostics;
  }
}
