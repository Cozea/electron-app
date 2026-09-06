import { memo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon as __CheckIconHugeIcon } from "@hugeicons/core-free-icons";

import { type ApprovalRequestId } from "@cozea/assistant-contracts";

import { type PendingUserInput } from "@/features/assistant/chat/session-logic";
import {
  derivePendingUserInputProgress,
  pendingUserInputShortcutValue,
  shouldAutoAdvancePendingUserInput,
  type PendingUserInputDraftAnswer,
} from "@/features/assistant/pendingUserInput";
import { cn } from "@/lib/utils";

interface PendingUserInputPanelProps {
  isVisible?: boolean;
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  isVisible = true,
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onSelectOption,
  onAdvance,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      isVisible={isVisible}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onSelectOption={onSelectOption}
      onAdvance={onAdvance}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  isVisible,
  prompt,
  isResponding,
  answers,
  questionIndex,
  onSelectOption,
  onAdvance,
}: {
  isVisible: boolean;
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onAdvance: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement>(null);
  const previousQuestionIdRef = useRef<string | null>(activeQuestion?.id ?? null);

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, [isVisible, questionIndex, isResponding]);

  // Advancing replaces the keyed question card. Restore focus before paint so
  // numeric shortcuts keep working on the next question without an extra click.
  useLayoutEffect(() => {
    const nextQuestionId = activeQuestion?.id ?? null;
    const previousQuestionId = previousQuestionIdRef.current;
    previousQuestionIdRef.current = nextQuestionId;
    if (!nextQuestionId || previousQuestionId === nextQuestionId || !isVisible || isResponding) {
      return;
    }
    questionCardRef.current?.focus({ preventScroll: true });
  }, [activeQuestion?.id, isResponding, isVisible]);

  const selectOptionAndAutoAdvance = useCallback(
    (questionId: string, optionLabel: string) => {
      if (!isVisible || isResponding) return;
      onSelectOption(questionId, optionLabel);
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
      if (!shouldAutoAdvancePendingUserInput(activeQuestion)) return;
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvance();
      }, 200);
    },
    [onSelectOption, onAdvance, activeQuestion?.multiSelect, isVisible, isResponding],
  );

  // Shortcuts belong to this question card, never another tile's editor.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeQuestion) return;
    const target = event.target;
    const value = pendingUserInputShortcutValue(activeQuestion, event.key, {
      visible: isVisible,
      responding: isResponding,
      editing:
        target instanceof HTMLElement &&
        (target.isContentEditable || Boolean(target.closest("input, textarea"))),
      modified: event.metaKey || event.ctrlKey || event.altKey,
    });
    if (value === null) return;
    event.preventDefault();
    event.stopPropagation();
    selectOptionAndAutoAdvance(activeQuestion.id, value);
  };

  if (!activeQuestion) {
    return null;
  }

  return (
    <div
      ref={questionCardRef}
      key={activeQuestion.id}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 flex-col px-4 py-3 sm:px-5 animate-in fade-in-0 slide-in-from-right-1 duration-150 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {prompt.questions.length > 1 ? (
            <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground/60">
              {questionIndex + 1}/{prompt.questions.length}
            </span>
          ) : null}
          <span className="text-[11px] font-semibold text-muted-foreground/50">
            {activeQuestion.header.charAt(0).toUpperCase() +
              activeQuestion.header.slice(1).toLowerCase()}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{activeQuestion.question}</p>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {activeQuestion.options.map((option, index) => {
          const isSelected = progress.selectedOptionValues.includes(option.value ?? option.label);
          const shortcutKey = index < 9 ? index + 1 : null;
          return (
            <button
              key={`${activeQuestion.id}:${option.value ?? option.label}:${index}`}
              aria-pressed={isSelected}
              type="button"
              disabled={isResponding}
              onClick={() =>
                selectOptionAndAutoAdvance(activeQuestion.id, option.value ?? option.label)
              }
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150",
                isSelected
                  ? "border-transparent bg-accent text-accent-foreground"
                  : "border-transparent bg-transparent text-foreground/80 hover:bg-accent/50 hover:text-accent-foreground",
                isResponding && "opacity-50 cursor-not-allowed",
              )}
            >
              {shortcutKey !== null ? (
                <kbd
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-[5px] border text-[10px] font-medium tabular-nums transition-colors duration-150",
                    isSelected
                      ? "border-border/80 bg-background text-foreground shadow-sm"
                      : "border-border/60 bg-background/50 text-muted-foreground/50 group-hover:border-border/80 group-hover:bg-background group-hover:text-muted-foreground/80",
                  )}
                >
                  {shortcutKey}
                </kbd>
              ) : null}
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.label}</span>
                {option.description && option.description !== option.label ? (
                  <span className="block mt-0.5 text-xs text-muted-foreground/60 line-clamp-2">
                    {option.description}
                  </span>
                ) : null}
              </div>
              {isSelected ? (
                <HugeiconsIcon
                  icon={__CheckIconHugeIcon}
                  className="size-3.5 shrink-0 text-foreground"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
});
