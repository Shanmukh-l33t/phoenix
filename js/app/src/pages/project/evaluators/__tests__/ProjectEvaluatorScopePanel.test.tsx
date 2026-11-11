import { act, startTransition, use } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelayEnvironmentProvider } from "react-relay";
import { createMockEnvironment, MockPayloadGenerator } from "relay-test-utils";

import { installTestMatchMedia } from "@phoenix/__tests__/installTestMatchMedia";
import { installTestStorage } from "@phoenix/__tests__/installTestStorage";
import { EvaluatorInputVariablesProvider } from "@phoenix/components/evaluators/EvaluatorInputVariablesContext/EvaluatorInputVariablesProvider";
import { ThemeProvider } from "@phoenix/contexts";
import { CredentialsProvider } from "@phoenix/contexts/CredentialsContext";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import { PreferencesProvider } from "@phoenix/contexts/PreferencesContext";
import { ProjectEvaluatorScopePanel } from "@phoenix/pages/project/evaluators/ProjectEvaluatorScopePanel";
import { ProjectEvaluatorSlideover } from "@phoenix/pages/project/evaluators/ProjectEvaluatorSlideover";
import { ProjectEvaluatorTimeWindowProvider } from "@phoenix/pages/project/evaluators/ProjectEvaluatorTestBench";
import type { ProjectEvaluatorScope } from "@phoenix/pages/project/evaluators/projectEvaluatorTypes";
import { DEFAULT_LLM_EVALUATOR_STORE_VALUES } from "@phoenix/store/evaluatorStore";

installTestMatchMedia();
installTestStorage();

const SCOPE: ProjectEvaluatorScope = {
  targetType: "SPAN",
  filterCondition: "parent_id is None",
  samplingRate: 1,
  evaluationDelaySeconds: 0,
  tracingEnabled: true,
};

function countPreviewQueries(
  environment: ReturnType<typeof createMockEnvironment>
) {
  return environment.mock
    .getAllOperations()
    .filter(({ request }) =>
      request.node.params.name.startsWith("ProjectEvaluatorScopePanel")
    ).length;
}

describe("ProjectEvaluatorScopePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T20:12:55.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("sends its preview queries once while the form beside it is still loading", async () => {
    const environment = createMockEnvironment();
    let resolveFormQuery: () => void = () => {};
    const formQuery = new Promise<void>((resolve) => {
      resolveFormQuery = resolve;
    });
    function LoadingFormSection() {
      use(formQuery);
      return null;
    }
    await act(async () =>
      root.render(
        <RelayEnvironmentProvider environment={environment}>
          <ThemeProvider themeMode="light">
            <ProjectEvaluatorSlideover isOpen title="Create evaluator">
              {() => (
                <>
                  <LoadingFormSection />
                  <ProjectEvaluatorScopePanel
                    projectId="project-1"
                    scope={SCOPE}
                    decision={{ blocker: "No decision" }}
                  />
                </>
              )}
            </ProjectEvaluatorSlideover>
          </ThemeProvider>
        </RelayEnvironmentProvider>
      )
    );
    expect(countPreviewQueries(environment)).toBe(2);

    vi.setSystemTime(new Date("2026-11-10T20:13:05.000Z"));
    await act(async () => resolveFormQuery());

    expect(countPreviewQueries(environment)).toBe(2);
  });

  it("shows its loading state as soon as the filter changes", async () => {
    const environment = createMockEnvironment();
    const renderPanel = (filterCondition: string) =>
      root.render(
        <RelayEnvironmentProvider environment={environment}>
          <ThemeProvider themeMode="light">
            <PreferencesProvider>
              <CredentialsProvider>
                <EvaluatorStoreProvider
                  initialState={DEFAULT_LLM_EVALUATOR_STORE_VALUES}
                >
                  <EvaluatorInputVariablesProvider variables={[]}>
                    <ProjectEvaluatorTimeWindowProvider>
                      <ProjectEvaluatorScopePanel
                        projectId="project-1"
                        scope={{ ...SCOPE, filterCondition }}
                        decision={{ blocker: "No decision" }}
                      />
                    </ProjectEvaluatorTimeWindowProvider>
                  </EvaluatorInputVariablesProvider>
                </EvaluatorStoreProvider>
              </CredentialsProvider>
            </PreferencesProvider>
          </ThemeProvider>
        </RelayEnvironmentProvider>
      );
    const findLoadingState = () =>
      container.querySelector('[role="status"][aria-label="Loading spans"]');
    await act(async () => renderPanel("parent_id is None"));
    for (const operation of environment.mock.getAllOperations()) {
      await act(async () =>
        environment.mock.resolve(
          operation,
          MockPayloadGenerator.generate(operation)
        )
      );
    }
    expect(findLoadingState()).toBeNull();

    // The filter field applies a validated condition inside a transition.
    await act(async () =>
      startTransition(() => renderPanel("span_kind == 'LLM'"))
    );

    expect(findLoadingState()).not.toBeNull();
  });
});
