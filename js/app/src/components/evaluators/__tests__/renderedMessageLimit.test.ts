import {
  describeRenderedMessageLimit,
  formatByteCount,
  getRenderedMessageBytes,
  getRenderedMessageWarning,
  ONLINE_EVAL_MAX_RENDERED_MESSAGE_BYTES,
  parseRenderedMessageLimit,
} from "../renderedMessageLimit";

describe("parseRenderedMessageLimit", () => {
  it("reads the size and the limit out of the server error", () => {
    expect(
      parseRenderedMessageLimit(
        "EvalExecutionError: Rendered online-eval messages are 89859 bytes, exceeding the 65536-byte limit."
      )
    ).toEqual({ bytes: 89_859, limit: 65_536 });
  });

  it("falls back to the default limit for the bare terminal state", () => {
    expect(
      parseRenderedMessageLimit(
        "Online-eval work unit 9 reached terminal state RENDERED_MESSAGE_TOO_LARGE"
      )
    ).toEqual({ bytes: null, limit: ONLINE_EVAL_MAX_RENDERED_MESSAGE_BYTES });
  });

  it("ignores unrelated errors", () => {
    expect(parseRenderedMessageLimit("rate limit exceeded")).toBeNull();
  });
});

describe("describeRenderedMessageLimit", () => {
  it("names the size, the limit and the knobs to change", () => {
    const { title, description } = describeRenderedMessageLimit({
      bytes: 89_859,
      limit: 65_536,
    });
    expect(title).toBe("Rendered prompt exceeds the limit");
    expect(description).toContain("89,859 bytes (87.8 KB)");
    expect(description).toContain("65,536 bytes (64.0 KB)");
    expect(description).toContain("path mapping");
    expect(description).toContain("PHOENIX_ONLINE_EVAL_MAX_LLM_MESSAGE_BYTES");
  });

  it("still explains the limit when the size was not reported", () => {
    const { description } = describeRenderedMessageLimit({
      bytes: null,
      limit: 65_536,
    });
    expect(description).toContain("exceeded the 65,536 bytes (64.0 KB) limit");
  });
});

describe("getRenderedMessageBytes", () => {
  it("measures UTF-8 bytes, not characters", () => {
    expect(getRenderedMessageBytes(["abc"])).toBe(3);
    expect(getRenderedMessageBytes(["é", "🙂"])).toBe(6);
    expect(getRenderedMessageBytes([])).toBe(0);
  });
});

describe("getRenderedMessageWarning", () => {
  it("warns from 90% of the limit", () => {
    expect(getRenderedMessageWarning(58_982)).toBeNull();
    expect(getRenderedMessageWarning(58_983)?.level).toBe("warning");
  });

  it("reports a preview that is already over the limit", () => {
    const warning = getRenderedMessageWarning(89_859);
    expect(warning?.level).toBe("danger");
    expect(warning?.description).toContain("over the 65,536 bytes (64.0 KB)");
  });
});

describe("formatByteCount", () => {
  it("groups digits and converts to KB", () => {
    expect(formatByteCount(65_536)).toBe("65,536 bytes (64.0 KB)");
    expect(formatByteCount(89_859)).toBe("89,859 bytes (87.8 KB)");
  });
});
