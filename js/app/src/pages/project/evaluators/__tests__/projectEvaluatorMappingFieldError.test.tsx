/**
 * A mapping path that reads nothing on the record is the reason a run fails,
 * and the path field only said so in a hover badge. So the field carries the
 * error state itself and names the failure under it, in the same wording as
 * the inputs preview.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluatorInputVariablesContext } from "@phoenix/components/evaluators/EvaluatorInputVariablesContext/evaluatorInputVariablesContext";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import { ProjectEvaluatorInputMapping } from "@phoenix/pages/project/evaluators/ProjectEvaluatorInputMapping";
import {
  type EvaluatorMappingSourceState,
  type EvaluatorStoreInstance,
  defaultEvaluatorMappingSourceState,
} from "@phoenix/store/evaluatorStore";
import type { SpanEvaluatorMappingSource } from "@phoenix/types";

vi.mock("@phoenix/components/evaluators/EvaluatorPathField", () => ({
  EvaluatorPathField: ({
    ariaLabel,
    isInvalid,
    errorMessage,
  }: {
    ariaLabel: string;
    isInvalid: boolean;
    errorMessage?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      readOnly
      data-invalid={isInvalid || undefined}
      data-error={errorMessage ?? undefined}
    />
  ),
}));

/** A sampled span: `metadata.name` binds, `metadata.nope` does not. */
const SPAN_SOURCE: SpanEvaluatorMappingSource = {
  input: "hello",
  output: "world",
  metadata: { name: "chat", attributes: { kind: "LLM" } },
};

const SAMPLED_SPAN: EvaluatorMappingSourceState = {
  recordKind: "span",
  source: SPAN_SOURCE,
};

describe("a project evaluator's mapping field", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: EvaluatorStoreInstance | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderForm = async ({
    pathMapping,
    declaredVariables = ["question"],
    requiredVariables,
    evaluatorMappingSource = SAMPLED_SPAN,
  }: {
    pathMapping: Record<string, string>;
    declaredVariables?: string[];
    requiredVariables?: string[];
    evaluatorMappingSource?: EvaluatorMappingSourceState;
  }) => {
    await act(async () => {
      root.render(
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
            evaluatorMappingSource,
          }}
        >
          {({ store: storeInstance }) => {
            store = storeInstance;
            return (
              <EvaluatorInputVariablesContext.Provider
                value={declaredVariables}
              >
                <ProjectEvaluatorInputMapping
                  recordKind="span"
                  requiredVariables={requiredVariables ?? declaredVariables}
                  canDescribeInputs={false}
                />
              </EvaluatorInputVariablesContext.Provider>
            );
          }}
        </EvaluatorStoreProvider>
      );
    });
  };

  const fieldFor = (variable: string) =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${variable} path mapping"]`
    );
  const fieldErrorMessage = () =>
    container.querySelector(".project-evaluator-input-mapping__error");

  it("marks the field and names what the path reads on the record", async () => {
    await renderForm({ pathMapping: { question: "metadata.nope" } });

    const field = fieldFor("question");
    // The error state is on the field itself, not only in a hover badge.
    expect(field?.getAttribute("data-invalid")).toBe("true");
    // The field's badge is a truncating pill, so the whole sentence is read
    // under the field instead of inside it.
    expect(field?.hasAttribute("data-error")).toBe(false);
    expect(container.textContent).toContain(
      "metadata.nope does not exist on this span, so evaluation fails"
    );
    expect(fieldErrorMessage()).not.toBeNull();
  });

  it("leaves a path that binds alone", async () => {
    await renderForm({ pathMapping: { question: "metadata.name" } });

    expect(fieldFor("question")?.hasAttribute("data-invalid")).toBe(false);
    expect(fieldErrorMessage()).toBeNull();
  });

  it("holds the wording until the field is left, for a path still being typed", async () => {
    await renderForm({ pathMapping: { question: "metadata.attributes[" } });
    // Mounted with its field focused: the path may still be arriving.
    await act(async () => {
      store!.getState().setFocusedMappingVariable("question");
    });
    expect(fieldErrorMessage()).toBeNull();

    await act(async () => {
      store!.getState().setFocusedMappingVariable(null);
    });
    expect(container.textContent).toContain(
      "metadata.attributes[ is not a valid path"
    );
  });

  it("says nothing about a variable whose failure is only optional", async () => {
    await renderForm({
      pathMapping: { question: "metadata.nope" },
      requiredVariables: [],
    });
    expect(fieldErrorMessage()).toBeNull();
  });

  it("does not blame a path before a record has been sampled", async () => {
    await renderForm({
      pathMapping: { question: "metadata.nope" },
      evaluatorMappingSource: defaultEvaluatorMappingSourceState("span"),
    });
    expect(fieldFor("question")?.hasAttribute("data-invalid")).toBe(false);
    expect(fieldErrorMessage()).toBeNull();
  });
});
