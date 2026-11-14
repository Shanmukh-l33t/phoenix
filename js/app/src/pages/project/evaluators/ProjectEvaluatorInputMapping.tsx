import { css } from "@emotion/react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { Text } from "@phoenix/components";
import { materializeEvaluatorContext } from "@phoenix/components/evaluators/evaluatorContext";
import { EvaluatorInputDescriptionEditor } from "@phoenix/components/evaluators/EvaluatorInputDescriptionEditor";
import { useEvaluatorInputMappingControlsForm } from "@phoenix/components/evaluators/EvaluatorInputMapping";
import { useEvaluatorInputVariables } from "@phoenix/components/evaluators/EvaluatorInputVariablesContext/useEvaluatorInputVariables";
import { EvaluatorPathField } from "@phoenix/components/evaluators/EvaluatorPathField";
import { getEvaluatorInputPlaceholder } from "@phoenix/components/evaluators/evaluatorSlotDefaults";
import { escapeFieldNameForReactHookForm } from "@phoenix/components/evaluators/fieldNameUtils";
import { SwitchableEvaluatorInput } from "@phoenix/components/evaluators/SwitchableEvaluatorInput";
import { useEvaluatorStore } from "@phoenix/contexts/EvaluatorContext";
import {
  dropOtherRecordKindPathMappings,
  dropPathsShadowedByLiterals,
  formatMissingBindingMessage,
  getProjectEvaluatorMappingDiagnostics,
  type ProjectEvaluatorRecordKind,
} from "@phoenix/pages/project/evaluators/projectEvaluatorTypes";
import type { EvaluatorInputMapping } from "@phoenix/types";

/** A path is written against the record, not against what the mapping makes. */
const UNMAPPED: EvaluatorInputMapping = { pathMapping: {}, literalMapping: {} };

/**
 * What is wrong with one variable's path as it stands, in the wording the
 * inputs preview uses, or null where nothing is: a path that binds, an empty
 * one, or one that cannot be checked because no record has been sampled yet.
 *
 * A path the server rejects is left alone while its field has focus, since it
 * is still being typed. A path that reads nothing is reported either way: it
 * fails the run as written, and the field alone does not say so.
 */
export function getInputMappingFieldError({
  variable,
  path,
  context,
  recordKind,
  requiredVariables,
  hasSampledRecord,
  isFocused,
}: {
  variable: string;
  path: string;
  context: unknown;
  recordKind: ProjectEvaluatorRecordKind;
  requiredVariables?: readonly string[];
  hasSampledRecord: boolean;
  isFocused: boolean;
}): string | null {
  if (path === "" || !hasSampledRecord) {
    return null;
  }
  const [diagnostic] = getProjectEvaluatorMappingDiagnostics({
    context,
    pathMapping: { [variable]: path },
    variables: [variable],
    ...(requiredVariables ? { requiredVariables: [...requiredVariables] } : {}),
  });
  if (diagnostic.status === "missing") {
    return formatMissingBindingMessage(diagnostic, recordKind);
  }
  if (diagnostic.status === "invalid" && !isFocused) {
    return `${path} is not a valid path`;
  }
  return null;
}

/**
 * Where the evaluator's declared variables are read from on the record it
 * runs on, one full-width row per variable: the name above the path field,
 * and under the field what the variable should hold, when the author has
 * described it, with an "edit" link at the end of that line that edits the
 * text in a popover, so the rows stay as tall as their fields.
 *
 * A path that reads nothing on the sampled record puts the field in its error
 * state and says why on the line under it, so a mapping that would fail the
 * run is read without opening the field's error badge.
 *
 * `input`, `output`, and `metadata` read their matching context fields when
 * left blank. Other variables need a path unless they are optional code
 * parameters or already have a saved text binding.
 */
export const ProjectEvaluatorInputMapping = ({
  recordKind,
  requiredVariables,
  emptyState,
  canDescribeInputs = true,
}: {
  recordKind: ProjectEvaluatorRecordKind;
  /**
   * Shown in place of the rows when the evaluator declares no variables.
   * The controls form hook above the early return still runs then, and it
   * is what drops a removed variable's mapping from the store, so the
   * return has to stay below it.
   */
  emptyState?: ReactNode;
  /** Every declared variable when omitted, as for a prompt. */
  requiredVariables?: readonly string[];
  /**
   * Whether the form saves the evaluator's definition, so a description
   * written here persists. A form that only binds an existing evaluator
   * shows its descriptions without the link to edit them.
   */
  canDescribeInputs?: boolean;
}) => {
  const variables = useEvaluatorInputVariables();
  const { control, getValues, setValue } = useEvaluatorInputMappingControlsForm(
    {
      pruneEmptyEntries: true,
      // Mounted under a key of the record kind, so switching what the evaluator
      // runs on rebuilds these rows without the previous record kind's paths in
      // them.
      filterInitialMapping: (inputMapping) =>
        dropPathsShadowedByLiterals(
          dropOtherRecordKindPathMappings(inputMapping, recordKind)
        ),
      declaredVariables: variables,
      pathsReplaceLiterals: true,
    }
  );
  const evaluatorMappingSource = useEvaluatorStore(
    (state) => state.evaluatorMappingSource
  );
  // The form drops a variable's literal once it has a path, and hides a path
  // a literal overrides, so a literal here is what the variable reads.
  const literalMapping = useEvaluatorStore(
    (state) => state.evaluator.inputMapping.literalMapping
  );
  const inputDescriptions = useEvaluatorStore(
    (state) => state.evaluator.inputDescriptions
  );
  const setInputDescription = useEvaluatorStore(
    (state) => state.setInputDescription
  );
  const setFocusedMappingVariable = useEvaluatorStore(
    (state) => state.setFocusedMappingVariable
  );
  // A path the server rejects already reads as being typed while its own field
  // has focus, so the row's message waits until the author leaves it.
  const focusedMappingVariable = useEvaluatorStore(
    (state) => state.focusedMappingVariable ?? null
  );
  // A saved mapping is not marked wrong while its records load: nothing is
  // known to read a path against until one has been sampled.
  const hasSampledRecord = useMemo(
    () =>
      materializeEvaluatorContext({
        recordKind,
        evaluatorMappingSource,
        inputMapping: UNMAPPED,
      })?.hasSampledRecord ?? false,
    [recordKind, evaluatorMappingSource]
  );
  if (variables.length === 0) {
    return emptyState ?? null;
  }
  return (
    <div css={mappingRowsCSS}>
      {variables.map((variable) => {
        const description = inputDescriptions[variable] ?? "";
        return (
          <SwitchableEvaluatorInput
            key={variable}
            fieldName={escapeFieldNameForReactHookForm(variable)}
            label={variable}
            descriptionExtra={
              canDescribeInputs ? (
                <EvaluatorInputDescriptionEditor
                  inputName={variable}
                  description={description}
                  onSave={(text) => setInputDescription(variable, text)}
                />
              ) : undefined
            }
            description={description || undefined}
            size="M"
            control={control}
            getValues={getValues}
            setValue={setValue}
            pathOptions={[]}
            allowsLiteral={false}
            renderPathInput={({
              value,
              onChange,
              isInvalid,
              errorMessage,
              ariaLabel,
            }) => {
              // The form's own rule (a required field left empty) wins, so a
              // path that also reads nothing is not reported twice.
              const fieldError = isInvalid
                ? errorMessage
                : (getInputMappingFieldError({
                    variable,
                    path: value,
                    context: evaluatorMappingSource?.source,
                    recordKind,
                    requiredVariables,
                    hasSampledRecord,
                    isFocused: focusedMappingVariable === variable,
                  }) ?? undefined);
              return (
                <div
                  css={mappingFieldCSS}
                  className="project-evaluator-input-mapping__field"
                >
                  <EvaluatorPathField
                    value={value}
                    onChange={onChange}
                    // The field reads as errored, and the line under it says
                    // why: the field's own badge is a truncating pill, so it
                    // keeps its terse wording rather than the whole sentence.
                    isInvalid={Boolean(fieldError)}
                    errorMessage={isInvalid ? errorMessage : undefined}
                    ariaLabel={ariaLabel}
                    evaluatorMappingSource={evaluatorMappingSource}
                    recordKind={recordKind}
                    onFocusChange={(isFocused) =>
                      setFocusedMappingVariable(isFocused ? variable : null)
                    }
                    placeholder={getEvaluatorInputPlaceholder({
                      variableName: variable,
                      isRequired: requiredVariables?.includes(variable) ?? true,
                      literal: Object.hasOwn(literalMapping, variable)
                        ? literalMapping[variable]
                        : undefined,
                    })}
                  />
                  {/* Under the field rather than in the field's hover badge,
                      so what fails the run is read without reaching for it. */}
                  {fieldError ? (
                    <Text
                      size="XS"
                      color="danger"
                      role="alert"
                      className="project-evaluator-input-mapping__error"
                    >
                      {fieldError}
                    </Text>
                  ) : null}
                </div>
              );
            }}
          />
        );
      })}
    </div>
  );
};

const mappingRowsCSS = css`
  display: flex;
  flex-direction: column;
  gap: var(--global-dimension-size-200);
  width: 100%;
`;

/** The path field and, when it has one, the message that explains it. */
const mappingFieldCSS = css`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--global-dimension-size-50);
  width: 100%;
  min-width: 0;
`;
