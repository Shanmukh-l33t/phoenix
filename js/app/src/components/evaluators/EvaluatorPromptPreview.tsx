/**
 * A component that shows a preview of the prompt that will be used for the llm evals
 **/

import { css } from "@emotion/react";
import { Suspense, useMemo } from "react";
import { graphql, useLazyLoadQuery } from "react-relay";
import invariant from "tiny-invariant";
import { useShallow } from "zustand/react/shallow";

import { Card, Flex, Icon, Icons, Text, View } from "@phoenix/components";
import { Skeleton } from "@phoenix/components/core/loading/Skeleton";
import type {
  ContentPartInput,
  EvaluatorPromptPreviewQuery,
  PromptChatTemplateInput,
  PromptTemplateFormat,
} from "@phoenix/components/evaluators/__generated__/EvaluatorPromptPreviewQuery.graphql";
import { parseEvaluatorPath } from "@phoenix/components/evaluators/evaluatorJsonPath";
import { ErrorBoundary } from "@phoenix/components/exception";
import type { ErrorBoundaryFallbackProps } from "@phoenix/components/exception/types";
import { useEvaluatorStore } from "@phoenix/contexts/EvaluatorContext";
import { usePlaygroundContext } from "@phoenix/contexts/PlaygroundContext";
import { useChatMessageStyles } from "@phoenix/hooks/useChatMessageStyles";
import { chatMessageRoleToPromptMessageRole } from "@phoenix/pages/playground/fetchPlaygroundPrompt";
import { denormalizePlaygroundInstance } from "@phoenix/pages/playground/playgroundUtils";
import {
  findToolCallArguments,
  findToolCallId,
  findToolCallName,
} from "@phoenix/schemas/toolCallSchemas";
import type {
  ChatMessage,
  PlaygroundChatTemplate,
} from "@phoenix/store/playground/types";
import type { EvaluatorInputMapping } from "@phoenix/types";
import { safelyStringifyJSON } from "@phoenix/utils/jsonUtils";

/**
 * Converts a ChatMessage to an array of ContentPartInput.
 * Handles text content, tool calls, and tool results.
 */
const chatMessageToContentParts = (
  message: ChatMessage
): ContentPartInput[] => {
  const parts: ContentPartInput[] = [];

  // Handle tool result messages (role === "tool" with toolCallId)
  if (message.role === "tool" && message.toolCallId) {
    parts.push({
      toolResult: {
        toolCallId: message.toolCallId,
        result: message.content ?? "",
      },
    });
    return parts;
  }

  // Handle text content
  if (message.content) {
    parts.push({
      text: { text: message.content },
    });
  }

  // Handle tool calls (typically from AI/assistant messages)
  if (message.toolCalls && message.toolCalls.length > 0) {
    for (const toolCall of message.toolCalls) {
      const toolCallId = findToolCallId(toolCall);
      const toolCallName = findToolCallName(toolCall);
      const toolCallArguments = findToolCallArguments(toolCall);

      if (toolCallId) {
        const argsStr =
          typeof toolCallArguments === "string"
            ? toolCallArguments
            : safelyStringifyJSON(toolCallArguments).json || "";
        parts.push({
          toolCall: {
            toolCallId,
            toolCall: {
              name: toolCallName || toolCallId,
              arguments: argsStr,
            },
          },
        });
      }
    }
  }

  return parts;
};

/**
 * A function that converts a playground chat template to a GQL chat template.
 * This is used to create a preview of the prompt that will be used for the llm evals.
 *
 * Note: this overlaps heavily with the instanceToPromptVersion function in fetchPlaygroundPrompt.ts
 * If used in the future, we should refactor to use the same function.
 */
export function playgroundChatTemplateToGqlPromptChatTemplate(
  template: PlaygroundChatTemplate
): PromptChatTemplateInput {
  return {
    messages: template.messages
      .map((message) => {
        const contentParts = chatMessageToContentParts(message);
        // Skip messages with no content parts
        if (contentParts.length === 0) {
          return null;
        }
        return {
          role: chatMessageRoleToPromptMessageRole(message.role),
          content: contentParts,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null),
  };
}

function EvaluatorPromptPreviewSkeleton({
  messageCount,
}: {
  messageCount: number;
}) {
  return (
    <Flex direction="column" gap="size-200">
      {Array.from({ length: messageCount }).map((_, i) => (
        <Skeleton key={i} height={300} />
      ))}
    </Flex>
  );
}

function EvaluatorPromptPreviewErrorFallback(
  _props: ErrorBoundaryFallbackProps
) {
  return (
    <View padding="size-200">
      <Flex direction="row" gap="size-100" alignItems="start">
        <Icon svg={<Icons.AlertCircle />} color="danger" />
        <Flex direction="column" gap="size-50">
          <Text weight="heavy" color="danger">
            Unable to render template preview
          </Text>
          <Text color="text-700">
            The template variables in your prompt may not match the available
            input mappings or parameters. Please check that all template
            variables (e.g. {"{{input}}"}, {"{{output}}"}, {"{{reference}}"})
            have corresponding values defined.
          </Text>
        </Flex>
      </Flex>
    </View>
  );
}

/**
 * The mapping the preview query can be handed right now. A path still being
 * typed is not yet one the server would accept — every keystroke of, say,
 * `input.tools` passes through `input.tools.`, which the server rejects with
 * "Invalid JSONPath expression …" and fails the whole preview over — so a path
 * that does not parse is held back until it does, the way the path field holds
 * back its own verdict until the field is left.
 */
export function toPreviewInputMapping(
  inputMapping: EvaluatorInputMapping
): EvaluatorInputMapping {
  return {
    literalMapping: inputMapping.literalMapping,
    pathMapping: Object.fromEntries(
      Object.entries(inputMapping.pathMapping).filter(
        ([, path]) => parseEvaluatorPath(path).isValid
      )
    ),
  };
}

export function EvaluatorPromptPreview() {
  const instance = usePlaygroundContext((state) => state.instances[0]);
  const allInstanceMessages = usePlaygroundContext(
    (state) => state.allInstanceMessages
  );
  const allInstanceDecisionPrompts = usePlaygroundContext(
    (state) => state.allInstanceDecisionPrompts
  );
  const templateFormat = usePlaygroundContext((state) => state.templateFormat);

  // Denormalize the instance to get the full template with messages
  const denormalizedInstance = useMemo(
    () =>
      denormalizePlaygroundInstance(
        instance,
        allInstanceMessages,
        allInstanceDecisionPrompts
      ),
    [instance, allInstanceMessages, allInstanceDecisionPrompts]
  );

  invariant(
    denormalizedInstance.template.__type === "chat",
    "Template must be a chat template"
  );

  const chatTemplate = denormalizedInstance.template as PlaygroundChatTemplate;

  // Convert the playground template to a GQL template
  const gqlTemplate = useMemo(
    () => playgroundChatTemplateToGqlPromptChatTemplate(chatTemplate),
    [chatTemplate]
  );

  const messageCount = gqlTemplate.messages.length;

  const { inputMapping, evaluatorMappingSource } = useEvaluatorStore(
    useShallow((state) => ({
      inputMapping: state.evaluator.inputMapping,
      evaluatorMappingSource: state.evaluatorMappingSource.source,
    }))
  );
  const previewInputMapping = useMemo(
    () => toPreviewInputMapping(inputMapping),
    [inputMapping]
  );
  // Everything the query reads, so a change to any of it clears a caught
  // error and the preview retries: whatever failed while a mapping was being
  // typed must not hold the preview down once the mapping is complete.
  const resetKey = useMemo(
    () =>
      JSON.stringify([
        gqlTemplate,
        templateFormat,
        previewInputMapping,
        evaluatorMappingSource ?? {},
      ]),
    [gqlTemplate, templateFormat, previewInputMapping, evaluatorMappingSource]
  );

  return (
    <ErrorBoundary
      fallback={EvaluatorPromptPreviewErrorFallback}
      resetKey={resetKey}
    >
      <Suspense
        fallback={
          <EvaluatorPromptPreviewSkeleton messageCount={messageCount} />
        }
      >
        <EvaluatorPromptPreviewContent
          gqlTemplate={gqlTemplate}
          templateFormat={templateFormat}
          inputMapping={previewInputMapping}
          variables={evaluatorMappingSource ?? {}}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

type EvaluatorPromptPreviewContentProps = {
  gqlTemplate: PromptChatTemplateInput;
  templateFormat: PromptTemplateFormat;
  inputMapping: EvaluatorInputMapping;
  variables: Record<string, unknown>;
};

function EvaluatorPromptPreviewContent(
  props: EvaluatorPromptPreviewContentProps
) {
  const { gqlTemplate, templateFormat, inputMapping, variables } = props;
  const data = useLazyLoadQuery<EvaluatorPromptPreviewQuery>(
    graphql`
      query EvaluatorPromptPreviewQuery(
        $template: PromptChatTemplateInput!
        $templateOptions: PromptTemplateOptions!
        $inputMapping: EvaluatorInputMappingInput!
      ) {
        prompt: applyChatTemplate(
          template: $template
          templateOptions: $templateOptions
          inputMapping: $inputMapping
        ) {
          messages {
            role
            content {
              __typename
              ... on TextContentPart {
                text {
                  text
                }
              }
            }
          }
        }
      }
    `,
    {
      template: gqlTemplate,
      templateOptions: {
        variables,
        format: templateFormat,
      },
      inputMapping,
    }
  );

  // Display the messages with applied template variables from the query result
  return (
    <Flex direction="column" gap="size-200">
      {data.prompt.messages.map((message, index) => {
        // Extract text content from the message
        const textContent = message.content
          .map((part) => {
            if (part.__typename === "TextContentPart" && part.text) {
              return part.text.text;
            }
            return null;
          })
          .filter(Boolean)
          .join("");

        return (
          <MessageCard key={index} role={message.role} content={textContent} />
        );
      })}
    </Flex>
  );
}

function MessageCard({ role, content }: { role: string; content: string }) {
  const styles = useChatMessageStyles(role as ChatMessage["role"]);
  return (
    <Card title={role} {...styles}>
      <pre
        css={css`
          white-space: pre-wrap;
          padding-left: var(--global-dimension-size-200);
          padding-right: var(--global-dimension-size-200);
        `}
      >
        {content}
      </pre>
    </Card>
  );
}
