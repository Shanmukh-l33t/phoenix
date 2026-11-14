import { act, use } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelayEnvironmentProvider } from "react-relay";
import { createMockEnvironment, type MockEnvironment } from "relay-test-utils";
import { userEvent } from "storybook/test";

import { installTestMatchMedia } from "@phoenix/__tests__/installTestMatchMedia";
import { EvaluatorInputVariablesProvider } from "@phoenix/components/evaluators/EvaluatorInputVariablesContext/EvaluatorInputVariablesProvider";
import { ThemeProvider } from "@phoenix/contexts";
import { CredentialsProvider } from "@phoenix/contexts/CredentialsContext";
import { EvaluatorStoreProvider } from "@phoenix/contexts/EvaluatorContext";
import {
  appendLoadedRows,
  ProjectEvaluatorScopePanel,
} from "@phoenix/pages/project/evaluators/ProjectEvaluatorScopePanel";
import { ProjectEvaluatorSlideover } from "@phoenix/pages/project/evaluators/ProjectEvaluatorSlideover";
import type { RecordedRunRow } from "@phoenix/pages/project/evaluators/projectEvaluatorTestBenchTypes";
import type { ProjectEvaluatorScope } from "@phoenix/pages/project/evaluators/projectEvaluatorTypes";
import { DEFAULT_LLM_EVALUATOR_STORE_VALUES } from "@phoenix/store/evaluatorStore";

installTestMatchMedia();

const SCOPE: ProjectEvaluatorScope = {
  targetType: "SPAN",
  filterCondition: "",
  samplingRate: 1,
  evaluationDelaySeconds: 0,
  tracingEnabled: true,
};

function spanEdge(name: string) {
  return {
    span: {
      id: `span-node-${name}`,
      name,
      spanId: `span-id-${name}`,
      spanKind: "LLM",
      startTime: "2026-11-10T20:00:00.000Z",
      latencyMs: 100,
      evaluationContext: { input: { question: name } },
      trace: { traceId: `trace-${name}`, id: `trace-node-${name}` },
    },
  };
}

const countPayload = {
  project: {
    __typename: "Project",
    id: "project-1",
    spanCountTimeSeries: { data: [{ totalCount: 40 }] },
  },
};

function spansPayload(names: readonly string[], hasNextPage: boolean) {
  return {
    project: {
      __typename: "Project",
      id: "project-1",
      spans: {
        edges: names.map(spanEdge),
        pageInfo: { hasNextPage },
      },
    },
  };
}

/** Answers every preview request the panel has sent and not yet been given. */
async function answerPreviewQueries(
  environment: MockEnvironment,
  spans: { names: readonly string[]; hasNextPage: boolean }
) {
  await act(async () => {
    for (const operation of environment.mock.getAllOperations()) {
      const { name } = operation.request.node.params;
      if (name === "ProjectEvaluatorScopePanelCountQuery") {
        environment.mock.resolve(operation, { data: countPayload });
      } else if (name === "ProjectEvaluatorScopePanelSpansQuery") {
        environment.mock.resolve(operation, {
          data: spansPayload(spans.names, spans.hasNextPage),
        });
      }
    }
  });
}

/** The records the bench lists, in the order it renders them. */
function listedRecords() {
  return [...document.querySelectorAll(".record-table__title")].map(
    (node) => node.textContent
  );
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

  it("appends the records a load more adds below the ones already listed", async () => {
    const environment = createMockEnvironment();
    await act(async () =>
      root.render(
        <RelayEnvironmentProvider environment={environment}>
          <ThemeProvider themeMode="light">
            <CredentialsProvider>
              <EvaluatorStoreProvider initialState={DEFAULT_LLM_EVALUATOR_STORE_VALUES}>
                <EvaluatorInputVariablesProvider variables={["input"]}>
                  <ProjectEvaluatorSlideover isOpen title="Create evaluator">
                    {() => (
                      <ProjectEvaluatorScopePanel
                        projectId="project-1"
                        scope={SCOPE}
                        decision={{ blocker: "No decision" }}
                      />
                    )}
                  </ProjectEvaluatorSlideover>
                </EvaluatorInputVariablesProvider>
              </EvaluatorStoreProvider>
            </CredentialsProvider>
          </ThemeProvider>
        </RelayEnvironmentProvider>
      )
    );
    const firstPage = Array.from({ length: 10 }, (_, index) => `span-${index}`);
    await answerPreviewQueries(environment, {
      names: firstPage,
      hasNextPage: true,
    });
    expect(listedRecords()).toEqual(firstPage);

    // The wider listing is the newest 20 records of a window that kept filling:
    // five records arrived after the first page, and the ten listed records are
    // still in it, followed by the ten older ones the reader asked for.
    const arrivedSince = Array.from(
      { length: 5 },
      (_, index) => `arrived-${index}`
    );
    const older = Array.from({ length: 10 }, (_, index) => `span-${index + 10}`);
    const loadMore = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Load More")
    );
    await act(async () => {
      await userEvent.click(loadMore!);
    });
    await answerPreviewQueries(environment, {
      names: [...arrivedSince, ...firstPage, ...older],
      hasNextPage: false,
    });

    expect(listedRecords()).toEqual([...firstPage, ...older]);
  });
});

function countPreviewQueries(environment: MockEnvironment) {
  return environment.mock
    .getAllOperations()
    .filter(({ request }) =>
      request.node.params.name.startsWith("ProjectEvaluatorScopePanel")
    ).length;
}
function rowsOf(names: readonly string[]): RecordedRunRow[] {
  return names.map((name) => ({
    key: name,
    name,
    recordId: name,
    context: { input: { question: name } },
    isSample: false,
  }));
}

function namesOf(rows: readonly RecordedRunRow[]): string[] {
  return rows.map(({ name }) => name);
}

describe("appendLoadedRows", () => {
  it("appends the rows a wider page added below the ones listed", () => {
    expect(
      namesOf(
        appendLoadedRows(
          rowsOf(["a", "b"]),
          rowsOf(["a", "b", "c", "d"])
        )
      )
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves records that arrived above the listed rows out of the front", () => {
    expect(
      namesOf(
        appendLoadedRows(
          rowsOf(["c", "d"]),
          rowsOf(["a", "b", "c", "d", "e", "f"])
        )
      )
    ).toEqual(["c", "d", "e", "f"]);
  });

  it("appends every unseen row when the last listed one is gone", () => {
    expect(
      namesOf(
        appendLoadedRows(
          rowsOf(["c", "d"]),
          rowsOf(["a", "b", "e", "f"])
        )
      )
    ).toEqual(["c", "d", "a", "b", "e", "f"]);
  });
});
