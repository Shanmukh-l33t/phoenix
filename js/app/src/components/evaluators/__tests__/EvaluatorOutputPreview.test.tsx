import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelayEnvironmentProvider } from "react-relay";
import { createMockEnvironment, type MockEnvironment } from "relay-test-utils";
import { userEvent } from "storybook/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestMatchMedia } from "@phoenix/__tests__/installTestMatchMedia";
import { ThemeProvider } from "@phoenix/contexts";
import { AgentProvider } from "@phoenix/contexts/AgentContext";
import { CredentialsProvider } from "@phoenix/contexts/CredentialsContext";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import { PlaygroundProvider } from "@phoenix/contexts/PlaygroundContext";

import { makeLLMEvaluatorInstance } from "../EvaluatorChatTemplate/utils";
import { EvaluatorOutputPreview } from "../EvaluatorOutputPreview";

installTestMatchMedia();

vi.mock("@phoenix/utils/reportClientError", () => ({
  reportClientError: vi.fn(),
}));

const TERMINAL_STATE_ERROR =
  "Online-eval work unit 9 reached terminal state RENDERED_MESSAGE_TOO_LARGE";

const SIZED_ERROR =
  "EvalExecutionError: Rendered online-eval messages are 89859 bytes, exceeding the 65536-byte limit. Narrow the slot with a path mapping, shorten the prompt, or raise the limit with PHOENIX_ONLINE_EVAL_MAX_LLM_MESSAGE_BYTES.";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderTestPanel(): MockEnvironment {
  const environment = createMockEnvironment();
  act(() => {
    root.render(
      <RelayEnvironmentProvider environment={environment}>
        <ThemeProvider themeMode="dark">
          <AgentProvider>
            <CredentialsProvider>
              <EvaluatorStoreProvider
                initialState={{
                  evaluator: {
                    id: "Evaluator:1",
                    globalName: "user_friction",
                    name: "user_friction",
                    kind: "LLM",
                    description: "",
                    isBuiltin: true,
                    includeExplanation: false,
                    inputMapping: { pathMapping: {}, literalMapping: {} },
                  },
                  outputConfigs: [],
                  evaluatorMappingSource: {
                    input: {},
                    output: {},
                    reference: {},
                    metadata: {},
                  },
                }}
              >
                <PlaygroundProvider
                  instances={makeLLMEvaluatorInstance({
                    modelConfigByProvider: {},
                  })}
                  modelConfigByProvider={{}}
                >
                  <EvaluatorOutputPreview />
                </PlaygroundProvider>
              </EvaluatorStoreProvider>
            </CredentialsProvider>
          </AgentProvider>
        </ThemeProvider>
      </RelayEnvironmentProvider>
    );
  });
  return environment;
}

async function testEvaluator(error: string): Promise<string> {
  const environment = renderTestPanel();
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Test")
  );
  expect(button).toBeDefined();
  await act(async () => {
    await userEvent.click(button!);
  });
  await act(async () => {
    environment.mock.resolveMostRecentOperation(() => ({
      data: {
        evaluatorPreviews: {
          results: [
            { evaluatorName: "user_friction", annotation: null, error },
          ],
        },
      },
    }));
  });
  return container.textContent ?? "";
}

describe("EvaluatorOutputPreview terminal states", () => {
  it("explains a RENDERED_MESSAGE_TOO_LARGE failure with the limit", async () => {
    const text = await testEvaluator(TERMINAL_STATE_ERROR);
    expect(text).toContain("Rendered prompt exceeds the limit");
    expect(text).toContain("65,536 bytes (64.0 KB)");
    expect(text).toContain("PHOENIX_ONLINE_EVAL_MAX_LLM_MESSAGE_BYTES");
    expect(text).toContain("path mapping");
  });

  it("shows the size the server rendered next to the limit", async () => {
    const text = await testEvaluator(SIZED_ERROR);
    expect(text).toContain("Rendered prompt exceeds the limit");
    expect(text).toContain("89,859 bytes (87.8 KB)");
    expect(text).toContain("65,536 bytes (64.0 KB)");
  });

  it("leaves unrelated evaluation errors untouched", async () => {
    const text = await testEvaluator("rate limit exceeded");
    expect(text).toContain("rate limit exceeded");
    expect(text).not.toContain("Rendered prompt exceeds the limit");
  });
});
