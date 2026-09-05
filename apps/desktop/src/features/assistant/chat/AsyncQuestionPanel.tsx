import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { questionDraftKey, useQuestionDraftStore } from "../questionDraftStore";
import type { PendingUserInput } from "./session-logic";

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
  const complete = request.questions.every((question) =>
    Boolean(draft?.answers[question.id]?.trim()),
  );
  const setAnswer = (questionId: string, answer: string) =>
    useQuestionDraftStore.getState().setAnswer(key, questionId, answer);
  return (
    <section
      aria-label="Questions from the agent"
      className="basis-full mb-2 max-h-[40vh] overflow-y-auto rounded-xl border border-border/60 bg-background/70 p-3"
    >
      <p className="mb-3 text-xs text-muted-foreground">
        The agent can keep working while you answer.
      </p>
      <div className="space-y-4">
        {request.questions.map((question) => {
          const value = draft?.answers[question.id] ?? "";
          const selected = question.options.some(
            (option) => (option.value ?? option.label) === value,
          );
          return (
            <fieldset key={question.id} disabled={frozen} className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{question.question}</legend>
              {question.options.map((option) => (
                <button
                  type="button"
                  key={option.value ?? option.label}
                  aria-pressed={value === (option.value ?? option.label)}
                  onClick={() => setAnswer(question.id, option.value ?? option.label)}
                  className={cn(
                    "block w-full rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-60",
                    value === (option.value ?? option.label)
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
                  value={selected ? "" : value}
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
