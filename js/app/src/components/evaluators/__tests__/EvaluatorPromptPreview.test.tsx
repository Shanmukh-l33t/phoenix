import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelayEnvironmentProvider } from "react-relay";
import { createMockEnvironment } from "relay-test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestMatchMedia } from "@phoenix/__tests__/installTestMatchMedia";
import { ThemeProvider } from "@phoenix/contexts";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import { PlaygroundProvider } from "@phoenix/contexts/PlaygroundContext";

import { makeLLMEvaluatorInstance } from "../EvaluatorChatTemplate/utils";
import { EvaluatorPromptPreview } from "../EvaluatorPromptPreview";

installTestMatchMedia();

vi.mock("@phoenix/utils/reportClientError", () => ({
  reportClientError: vi.fn(),
}));

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

async function renderPreview(renderedText: string): Promise<void> {
  const environment = createMockEnvironment();
  act(() => {
    root.render(
      <RelayEnvironmentProvider environment={environment}>
        <ThemeProvider themeMode="dark">
          <EvaluatorStoreProvider
            initialState={{
              evaluator: {
                globalName: "user_friction",
                name: "user_friction",
                kind: "LLM",
                description: "",
                isBuiltin: false,
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
              <EvaluatorPromptPreview />
            </PlaygroundProvider>
          </EvaluatorStoreProvider>
        </ThemeProvider>
      </RelayEnvironmentProvider>
    );
  });
  // the preview query is issued from inside a Suspense boundary
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await act(async () => {
    environment.mock.resolveMostRecentOperation(() => ({
      data: {
        prompt: {
          messages: [
            {
              role: "system",
              content: [
                { __typename: "TextContentPart", text: { text: renderedText } },
              ],
            },
          ],
        },
      },
    }));
  });
}

describe("EvaluatorPromptPreview size warning", () => {
  it("says the rendered preview is over the limit before a test run fails", async () => {
    await renderPreview("x".repeat(89_859));
    const text = container.textContent ?? "";
    expect(text).toContain("over the 65,536 bytes (64.0 KB) limit");
    expect(text).toContain("RENDERED_MESSAGE_TOO_LARGE");
  });

  it("warns while the rendered preview still fits", async () => {
    await renderPreview("x".repeat(60_000));
    const text = container.textContent ?? "";
    expect(text).toContain("92% of the 65,536 bytes (64.0 KB) limit");
    expect(text).toContain("RENDERED_MESSAGE_TOO_LARGE");
  });

  it("stays quiet for a small rendered preview", async () => {
    await renderPreview("score the reply");
    expect(container.textContent ?? "").not.toContain(
      "RENDERED_MESSAGE_TOO_LARGE"
    );
  });
});
