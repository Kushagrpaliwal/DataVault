import "./setup";
import { afterEach, describe, expect, test } from "bun:test";
import { getServerEnvironment } from "@data-vault/config";
import { generateStructured, strictSchema } from "../src/services/ai-provider";

/**
 * The server, with nothing in it that matters here.
 *
 * The only thing that is used is the guard on the address, and the address
 * is a public one so that the guard lets it through without a lookup.
 */
const environment = getServerEnvironment({
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://example@example.com/data-vault",
  SESSION_SECRET: "s".repeat(32),
  JWT_SECRET: "j".repeat(32),
  ALLOWED_ORIGINS: "http://localhost:5173",
  EXTENSION_REDIRECT_URL: "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/data-vault-auth",
  TRUSTED_PROXY_HOPS: "0",
  GEMINI_API_KEY: "test-key",
  AI_KEY_ENCRYPTION_KEY: Buffer.from("k".repeat(32)).toString("base64"),
});

const target = {
  kind: "openai-compatible" as const,
  baseUrl: "https://1.1.1.1/v1",
  apiKey: "sk-test",
  model: "gpt-test",
};

/**
 * The shape the features ask for.
 *
 * It is the same shape the free path uses, so that the test is about the
 * request that is made rather than about one shape in particular.
 */
const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" } },
    suggestedTitle: { type: "string" },
  },
  required: ["summary", "keyPoints", "suggestedTitle"],
};

const realFetch = globalThis.fetch;

/**
 * A provider that answers with the given responses, in order.
 *
 * Every request that is made is kept, so that the shape of the request can
 * be looked at. The provider is not a real one and nothing leaves the
 * machine.
 */
function captureFetch(responses: Array<{ status: number; body: unknown }>) {
  const requests: Array<Record<string, unknown>> = [];
  const queue = [...responses];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const next = queue.shift() ?? { status: 200, body: { choices: [{ message: { content: "{}" } }] } };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return requests;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const input = { system: "You are asked for a shape.", contents: "The words.", schema, maxOutputTokens: 200 };

describe("a provider that speaks the OpenAI language", () => {
  test("the shape it is asked for is one that strict mode accepts", async () => {
    const requests = captureFetch([{ status: 200, body: { choices: [{ message: { content: JSON.stringify({ summary: "a", keyPoints: [], suggestedTitle: "b" }) } }] } }]);
    await generateStructured(environment, target, input);

    const request = requests[0]!;
    const format = request.response_format as { type: string; json_schema: { schema: Record<string, unknown> } };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    /**
     * Every property is named as one that is required, because strict mode
     * will not accept a shape that leaves one out.
     */
    expect((format.json_schema.schema.required as string[]).sort()).toEqual(["keyPoints", "suggestedTitle", "summary"]);
  });

  test("a property that may be left out is made able to be null", async () => {
    const requests = captureFetch([{ status: 200, body: { choices: [{ message: { content: "{}" } }] } }]);
    await generateStructured(environment, target, {
      ...input,
      schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          added: { type: "boolean" },
          kind: { type: "string", enum: ["a", "b"] },
        },
        required: ["title"],
      },
    });

    const format = requests[0]!.response_format as { json_schema: { schema: { properties: Record<string, { type?: unknown; enum?: unknown[] }> } } };
    const properties = format.json_schema.schema.properties;
    expect(properties.added?.type).toEqual(["boolean", "null"]);
    expect(properties.kind?.enum).toEqual(["a", "b", null]);
    expect(properties.title?.type).toBe("string");
  });

  test("the word JSON is in the request that asks for JSON", async () => {
    /**
     * The first attempt is refused, so the second one is the one that is
     * looked at.
     */
    const requests = captureFetch([
      { status: 400, body: { error: { message: "Invalid schema" } } },
      { status: 200, body: { choices: [{ message: { content: "{}" } }] } },
    ]);
    await generateStructured(environment, target, input);

    expect(requests).toHaveLength(2);
    const second = requests[1]!;
    const messages = second.messages as Array<{ role: string; content: string }>;
    expect(`${messages[0]!.content} ${messages[1]!.content}`.toLowerCase()).toContain("json");
    expect((second.response_format as { type: string }).type).toBe("json_object");
  });

  test("the last attempt asks for JSON in the words of the model", async () => {
    const requests = captureFetch([
      { status: 400, body: { error: { message: "Invalid schema" } } },
      { status: 400, body: { error: { message: "response_format is not supported" } } },
      { status: 200, body: { choices: [{ message: { content: "{}" } }] } },
    ]);
    await generateStructured(environment, target, input);

    expect(requests).toHaveLength(3);
    const third = requests[2]!;
    expect(third.response_format).toBeUndefined();
    const messages = third.messages as Array<{ role: string; content: string }>;
    expect(`${messages[0]!.content} ${messages[1]!.content}`.toLowerCase()).toContain("json");
  });

  test("a model that wants another name for the limit is asked again with it", async () => {
    const requests = captureFetch([
      { status: 400, body: { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } } },
      { status: 200, body: { choices: [{ message: { content: "{}" } }] } },
    ]);
    await generateStructured(environment, target, input);

    expect(requests).toHaveLength(2);
    expect(requests[0]!.max_tokens).toBe(200);
    expect(requests[0]!.max_completion_tokens).toBeUndefined();
    expect(requests[1]!.max_completion_tokens).toBe(200);
    expect(requests[1]!.max_tokens).toBeUndefined();
  });

  test("the shape that is given is not changed by the strict one", async () => {
    const requests = captureFetch([{ status: 200, body: { choices: [{ message: { content: "{}" } }] } }]);
    await generateStructured(environment, target, input);
    const format = requests[0]!.response_format as { json_schema: { schema: Record<string, unknown> } };
    /**
     * The shape that is written down is the one that is read afterwards, and
     * it is not the strict one, because the limits in it still matter.
     */
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    expect((schema as Record<string, unknown>).additionalProperties).toBeUndefined();
    expect((schema.required as string[]).length).toBe(3);
  });
});

describe("the shape a provider is strict about", () => {
  test("the limits that a strict shape does not take are left out", () => {
    const cleaned = strictSchema({
      type: "object",
      properties: { text: { type: "string", maxLength: 10, minLength: 1, description: "kept" } },
      required: ["text"],
      title: "left out",
      default: {},
    });
    const properties = cleaned.properties as Record<string, Record<string, unknown>>;
    expect(properties.text!.maxLength).toBeUndefined();
    expect(properties.text!.minLength).toBeUndefined();
    expect(properties.text!.description).toBe("kept");
    expect(cleaned.title).toBeUndefined();
    expect(cleaned.default).toBeUndefined();
  });

  test("a list of things is made strict as well", () => {
    const cleaned = strictSchema({
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: { type: { type: "string" }, text: { type: "string" } },
            required: ["type"],
          },
        },
      },
      required: ["blocks"],
    });
    const items = (cleaned.properties as Record<string, { items: Record<string, unknown> }>).blocks!.items;
    expect(items.additionalProperties).toBe(false);
    expect((items.required as string[]).sort()).toEqual(["text", "type"]);
  });
});
