import { describe, expect, it } from "vitest";
import { parsePick } from "../src/matcher/picker.js";

const opencodeOutput = [
  '{"type":"step_start","timestamp":1,"sessionID":"s","part":{"id":"p","type":"step-start"}}',
  '{"type":"text","timestamp":2,"sessionID":"s","part":{"id":"q","type":"text","text":"{\\"productId\\":\\"1001\\",\\"confidence\\":0.9,\\"reason\\":\\"plain milk\\"}"}}',
].join("\n");

describe("model answer parsing", () => {
  it("unwraps opencode's JSON event stream", () => {
    const pick = parsePick(opencodeOutput, new Set(["1001", "1002"]));
    expect(pick).toMatchObject({ productId: "1001", confidence: 0.9, source: "llm" });
  });

  it("ignores an id that is not one of the safe candidates", () => {
    expect(parsePick(opencodeOutput, new Set(["1002"]))).toBeNull();
  });

  it("accepts a bare JSON answer", () => {
    const pick = parsePick(
      '{"productId":"1002","confidence":0.7,"reason":"x"}',
      new Set(["1001", "1002"]),
    );
    expect(pick?.productId).toBe("1002");
  });

  it("accepts a refusal", () => {
    const pick = parsePick(
      '{"productId":null,"confidence":0,"reason":"none fits"}',
      new Set(["1001"]),
    );
    expect(pick).toMatchObject({ productId: null, confidence: 0 });
  });
});
