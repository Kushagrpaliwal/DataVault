import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}

export function normalizeError(error: unknown, requestId: string) {
  if (error instanceof AppError) return { status: error.status, body: { success: false as const, error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }), requestId } } };
  if (error instanceof ZodError) return { status: 400, body: { success: false as const, error: { code: "VALIDATION_ERROR", message: "Some fields need your attention.", details: error.flatten(), requestId } } };
  /**
   * A route that does not exist is a 404, not a server fault. Without this
   * the framework's own not-found error is reported as a 500, which makes a
   * mistyped URL look like a broken server.
   */
  if (error instanceof Error && (error.name === "NOT_FOUND" || error.message === "NOT_FOUND")) {
    return { status: 404, body: { success: false as const, error: { code: "NOT_FOUND", message: "That endpoint does not exist.", requestId } } };
  }
  /**
   * A URL that could not be parsed is a bad request, not a server fault. Some
   * validators throw a raw TypeError instead of reporting a validation
   * problem, and that must not be reported as a 500.
   */
  if (error instanceof TypeError && /invalid url/i.test(error.message)) {
    return { status: 400, body: { success: false as const, error: { code: "VALIDATION_ERROR", message: "One of the fields is not a valid web address.", requestId } } };
  }
  console.error(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.message : "Unknown error", stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined }));
  return { status: 500, body: { success: false as const, error: { code: "INTERNAL_ERROR", message: "DataVault could not complete this request.", requestId } } };
}

export const notFound = (resource: string) => new AppError(404, `${resource.toUpperCase()}_NOT_FOUND`, `${resource.replaceAll("_", " ")} could not be found.`);
