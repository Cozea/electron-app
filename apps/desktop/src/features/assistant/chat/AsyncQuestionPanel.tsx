import { memo } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  pendingUserInputDraftFromAnswer,
  resolvePendingUserInputAnswer,
  togglePendingUserInputOptionSelection,
} from "@/features/assistant/pendingUserInput";
import { cn } from "@/lib/utils";
import { questionDraftKey, useQuestionDraftStore } from "@/features/assistant/questionDraftStore";
import type { PendingUserInput } from "@/features/assistant/chat/session-logic";

interface AsyncQuestionPanelProps {
  threadId: string;
  request: PendingUserInput;
  responding: boolean;
  onSubmit: (requestId: string) => void | Promise<void>;
}

/** Async answers have their own fields; the normal composer remains mounted. */
export const AsyncQuestionPanel = memo(function AsyncQuestionPanel({
  threadId,
  request,
  responding,
  onSubmit,
}: AsyncQuestionPanelProps) {
  const key = questionDraftKey(threadId, request);
  const draft = useQuestionDraftStore((state) => state.drafts[key]);
  const frozen = responding || Boolean(draft?.submission);
  const complete = request.questions.every(
    (question) =>
      resolvePendingUserInputAnswer(
        question,
        pendingUserInputDraftFromAnswer(question, draft?.answers[question.id]),
      ) !== null,
  );
  const setAnswer = (questionId: string, answer: string | string[]) =>
    useQuestionDraftStore.getState().setAnswer(key, questionId, answer);
  return (
    <section
      aria-label="Questions from the agent"
      className="basis-full mb-2 max-h-[40vh] overflow-y-auto rounded-xl border border-border/60 bg-background/70 p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        The agent can keep working while you answer.
      </p>
      <div className="space-y-4">
        {request.questions.map((question) => {
          const value = draft?.answers[question.id];
          const answerDraft = pendingUserInputDraftFromAnswer(question, value);
          const selectedValues = answerDraft.selectedOptionValues ?? [];
          return (
            <fieldset key={question.id} disabled={frozen} className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{question.question}</legend>
              {question.options.map((option, index) => (
                <button
                  type="button"
                  key={`${option.value ?? option.label}:${index}`}
                  aria-pressed={selectedValues.includes(option.value ?? option.label)}
                  onClick={() =>
                    setAnswer(
                      question.id,
                      resolvePendingUserInputAnswer(
                        question,
                        togglePendingUserInputOptionSelection(
                          question,
                          answerDraft,
                          option.value ?? option.label,
                        ),
                      ) ?? (question.multiSelect ? [] : ""),
                    )
                  }
                  className={cn(
                    "block w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60",
                    selectedValues.includes(option.value ?? option.label)
                      ? "border-foreground/30 bg-accent"
                      : "border-border/60 hover:bg-accent/50",
                  )}
                >
                  {option.label}
                  {option.description ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              ))}
              {question.allowCustomAnswer !== false ? (
                <Textarea
                  aria-label={`Answer: ${question.question}`}
                  placeholder={question.options.length ? "Or write an answer" : "Your answer"}
                  value={answerDraft.customAnswer ?? ""}
                  onChange={(event) => setAnswer(question.id, event.target.value)}
                  className="min-h-16 resize-y text-sm"
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {draft?.submission && !responding ? (
          <span className="text-xs text-muted-foreground">Retry sends the same answer.</span>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={responding || !complete}
          onClick={() => void onSubmit(String(request.requestId))}
        >
          {responding ? "Sending…" : draft?.submission ? "Retry answer" : "Send answer"}
        </Button>
      </div>
    </section>
  );
});
