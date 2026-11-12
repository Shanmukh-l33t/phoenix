/**
 * Reproduces https://github.com/Arize-ai/phoenix/issues/17883.
 *
 * Typing a mapping path (for example `input.tools` for a span's tool
 * definitions) writes every keystroke to the evaluator store, so the path
 * passes through states like `input.tools.` that the server rejects with
 * "Invalid JSONPath expression for key 'tools': Invalid JSONPath syntax: Parse
 * error near the end of string!". The preview query must not be handed a path
 * that is not done being typed, and the preview must render again once the
 * mapping is complete rather than staying on the error it latched.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type * as ReactRelay from "react-relay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestMatchMedia } from "@phoenix/__tests__/installTestMatchMedia";
import { makeLLMEvaluatorInstance } from "@phoenix/components/evaluators/EvaluatorChatTemplate/utils";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import { PlaygroundProvider } from "@phoenix/contexts/PlaygroundContext";
import type { EvaluatorStoreInstance } from "@phoenix/store/evaluatorStore";

import { EvaluatorPromptPreview } from "../EvaluatorPromptPreview";

const ISSUE_ERROR =
  "Invalid JSONPath expression for key 'tools': Invalid JSONPath syntax: Parse error near the end of string!";

const { queryVariables, serverState } = vi.hoisted(() => ({
  queryVariables: [] as Record<string, unknown>[],
  serverState: { error: null as string | null },
}));

vi.mock("react-relay", async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRelay>()),
  useLazyLoadQuery: (_node: unknown, variables: Record<string, unknown>) => {
    queryVariables.push(variables);
    if (serverState.error != null) {
      throw new Error(serverState.error);
    }
    return {
      prompt: {
        messages: [
          {
            role: "USER",
            content: [
              {
                __typename: "TextContentPart",
                text: { text: "PREVIEW RENDERED" },
              },
            ],
          },
        ],
      },
    };
  },
}));

installTestMatchMedia();

let container: HTMLDivElement;
let root: Root;
let store: EvaluatorStoreInstance | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  store = null;
  queryVariables.length = 0;
  serverState.error = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Preview({
  pathMapping,
  onStore,
}: {
  pathMapping: Record<string, string>;
  onStore: (store: EvaluatorStoreInstance) => void;
}) {
  return (
    <PlaygroundProvider
      modelConfigByProvider={{}}
      instances={makeLLMEvaluatorInstance({
        modelConfigByProvider: {},
        defaultMessages: [
          {
            id: 1,
            role: "user",
            content: "Judge these tools: {{tools}}",
          },
        ],
      })}
    >
      <EvaluatorStoreProvider
        initialState={{
          evaluator: {
            kind: "LLM",
            globalName: "",
            name: "",
            description: "",
            isBuiltin: false,
            includeExplanation: false,
            inputDescriptions: {},
            inputMapping: { pathMapping, literalMapping: {} },
          },
          evaluatorMappingSource: {
            recordKind: "span",
            source: { input: {}, output: {}, metadata: {} },
          },
        }}
      >
        {({ store }) => {
          onStore(store);
          return <EvaluatorPromptPreview />;
        }}
      </EvaluatorStoreProvider>
    </PlaygroundProvider>
  );
}

async function renderPreview(pathMapping: Record<string, string>) {
  await act(async () => {
    root.render(
      <Preview
        pathMapping={pathMapping}
        onStore={(storeInstance) => {
          store = storeInstance;
        }}
      />
    );
  });
}

describe("the evaluator prompt preview while a mapping path is being typed", () => {
  it("withholds a half-typed path from the preview query", async () => {
    // `input.tools.` is what the store holds after the keystroke that types
    // the dot of `input.tools`, and it is what the server rejects with the
    // issue's error.
    serverState.error = ISSUE_ERROR;
    await renderPreview({ tools: "input.tools." });
    const sent = queryVariables.at(-1)?.inputMapping as {
      pathMapping: Record<string, string>;
    };
    expect(sent).toBeDefined();
    expect(sent.pathMapping.tools).toBeUndefined();
    expect(sent.pathMapping).not.toHaveProperty("tools");
  });

  it("renders the preview once the mapping completes, after the rejected path errored it", async () => {
    serverState.error = ISSUE_ERROR;
    await renderPreview({ tools: "input.tools." });
    expect(container.textContent ?? "").not.toContain("PREVIEW RENDERED");
    await act(async () => {
      serverState.error = null;
      store!.getState().setPathMapping({ tools: "input.tools" });
    });
    expect(container.textContent ?? "").toContain("PREVIEW RENDERED");
  });
});
