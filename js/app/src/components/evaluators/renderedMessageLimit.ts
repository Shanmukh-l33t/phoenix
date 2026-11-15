/**
 * Helpers for the terminal `RENDERED_MESSAGE_TOO_LARGE` state that online
 * evaluations end in when the rendered prompt outgrows the server's message
 * size limit. The server reports both the bytes and the limit in its error
 * text, so the evaluator surfaces can explain the failure instead of echoing an
 * opaque state code.
 */

/** Default of the server's `PHOENIX_ONLINE_EVAL_MAX_LLM_MESSAGE_BYTES`. */
export const ONLINE_EVAL_MAX_RENDERED_MESSAGE_BYTES = 65_536;

/** Share of the limit at which a rendered preview warns before it fails. */
export const RENDERED_MESSAGE_WARNING_RATIO = 0.9;

const RENDERED_MESSAGE_TOO_LARGE_CODE = "RENDERED_MESSAGE_TOO_LARGE";

const renderedMessageLimitPattern =
  /Rendered online-eval messages are (\d+) bytes, exceeding the (\d+)-byte limit\./;

const remediation =
  "Narrow the evaluator input mapping with a path mapping so the prompt receives less data, shorten the prompt, or raise PHOENIX_ONLINE_EVAL_MAX_LLM_MESSAGE_BYTES.";

export type RenderedMessageLimit = {
  /** Bytes reported by the server, or null when only the state code survived. */
  bytes: number | null;
  limit: number;
};

export function formatByteCount(bytes: number): string {
  const exact = bytes.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${exact} bytes (${(bytes / 1024).toFixed(1)} KB)`;
}

/** Size of the text as the server measures it: UTF-8 encoded bytes. */
export function getRenderedMessageBytes(texts: readonly string[]): number {
  const encoder = new TextEncoder();
  return texts.reduce((total, text) => total + encoder.encode(text).length, 0);
}

/**
 * Reads the size and limit out of a surfaced error. Returns null when the error
 * is unrelated to the limit, and a null byte count when only the terminal state
 * code was surfaced (the state log line carries no sizes).
 */
export function parseRenderedMessageLimit(
  message: string
): RenderedMessageLimit | null {
  const match = renderedMessageLimitPattern.exec(message);
  if (match != null) {
    return { bytes: Number(match[1]), limit: Number(match[2]) };
  }
  if (message.includes(RENDERED_MESSAGE_TOO_LARGE_CODE)) {
    return { bytes: null, limit: ONLINE_EVAL_MAX_RENDERED_MESSAGE_BYTES };
  }
  return null;
}

export function describeRenderedMessageLimit({
  bytes,
  limit,
}: RenderedMessageLimit): { title: string; description: string } {
  const exceeded =
    bytes == null
      ? `The rendered prompt exceeded the ${formatByteCount(limit)} limit.`
      : `The rendered prompt is ${formatByteCount(bytes)}, over the ${formatByteCount(limit)} limit.`;
  return {
    title: "Rendered prompt exceeds the limit",
    description: `${exceeded} ${remediation}`,
  };
}

export type RenderedMessageWarning = {
  level: "warning" | "danger";
  description: string;
};

/**
 * Warns while the rendered preview still fits, or records that it will already
 * fail. Computed from the preview's rendered text, so it stays silent for
 * previews that contain no rendered content.
 */
export function getRenderedMessageWarning(
  bytes: number,
  limit: number = ONLINE_EVAL_MAX_RENDERED_MESSAGE_BYTES
): RenderedMessageWarning | null {
  if (bytes >= limit) {
    return {
      level: "danger",
      description: `The rendered preview is ${formatByteCount(bytes)}, over the ${formatByteCount(limit)} limit. Running this evaluator will fail with RENDERED_MESSAGE_TOO_LARGE. ${remediation}`,
    };
  }
  if (bytes >= limit * RENDERED_MESSAGE_WARNING_RATIO) {
    const share = Math.round((bytes / limit) * 100);
    return {
      level: "warning",
      description: `The rendered preview is ${formatByteCount(bytes)}, ${share}% of the ${formatByteCount(limit)} limit. Longer inputs will fail with RENDERED_MESSAGE_TOO_LARGE. ${remediation}`,
    };
  }
  return null;
}
