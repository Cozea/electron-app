import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "@/lib/i18n"
import {
  ArrowDown01Icon as __ChevronDownHugeIcon,
  ArrowUp01Icon as __ChevronUpHugeIcon,
  Tick02Icon as __CheckHugeIcon,
} from "@hugeicons/core-free-icons";

import { type ApprovalRequestId } from "@cozea/assistant-contracts";

import { Button } from "@/components/ui/button";
import GlideMenu from "@/components/primitives/GlideMenu";
import { type PendingUserInput } from "@/features/assistant/chat/session-logic";
import {
  derivePendingUserInputProgress,
  pendingUserInputShortcutValue,
  shouldAutoAdvancePendingUserInput,
  type PendingUserInputDraftAnswer,
} from "@/features/assistant/pendingUserInput";
import { cn } from "@/lib/utils";

/**
 * One question at a time. The stack slides vertically between questions while
 * the card's height animates to fit, and the step counter rolls like an
 * odometer. Single-select answers advance on their own; multi-select waits.
 *
 * Skip only moves on: the response contract rejects a partial answer set
 * (`buildPendingUserInputAnswers` returns null), so Send stays disabled until
 * every question has an answer.
 */

const SLIDE_MS = 360;
const SLIDE = `${SLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
const ROLL_MS = 400;
const AUTO_ADVANCE_MS = 200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Odometer digits: only the characters that changed roll. */
const RollingDigits = memo(function RollingDigits({ value }: { value: string }) {
  const previousRef = useRef(value);
  const [oldValue, setOldValue] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    if (previousRef.current === value) return;
    const from = previousRef.current;
    previousRef.current = value;

    if (prefersReducedMotion()) {
      setOldValue(value);
      return;
    }

    const fromNumber = Number.parseInt(from, 10);
    const toNumber = Number.parseInt(value, 10);
    setDirection(
      Number.isFinite(fromNumber) && Number.isFinite(toNumber) && toNumber < fromNumber
        ? "down"
        : "up",
    );
    setOldValue(from);
    setRolling(true);
    setShifted(false);

    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setShifted(true));
    });
    const settle = window.setTimeout(() => {
      setRolling(false);
      setOldValue(value);
      setShifted(false);
    }, ROLL_MS);

    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
      window.clearTimeout(settle);
    };
  }, [value]);

  const characters = rolling ? value : oldValue;

  return (
    <>
      {Array.from({ length: characters.length }, (_, index) => {
        const previous = oldValue[index] ?? "";
        const next = characters[index] ?? "";
        if (!rolling || previous === next) {
          return <span key={`${index}-${next}`}>{next}</span>;
        }
        const top = direction === "down" ? next : previous;
        const bottom = direction === "down" ? previous : next;
        const restY = direction === "down" ? "0" : "-1em";
        const startY = direction === "down" ? "-1em" : "0";
        return (
          <span
            key={`${index}-${previous}-${next}-${direction}`}
            className="relative inline-block h-[1em] overflow-hidden align-[-0.05em] leading-[1em]"
          >
            <span
              className="flex flex-col transition-transform duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{ transform: `translateY(${shifted ? restY : startY})` }}
            >
              <span className="h-[1em] leading-[1em]">{top}</span>
              <span className="h-[1em] leading-[1em]">{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
});

interface PendingUserInputPanelProps {
  isVisible?: boolean;
  pendingUserInputs: PendingUserInput[];
  respondingRequestIds: ApprovalRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onCustomAnswerChange: (questionId: string, customAnswer: string) => void;
  onAdvance: () => void;
  onPrevious: () => void;
  onSubmit: () => void;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  isVisible = true,
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onSelectOption,
  onCustomAnswerChange,
  onAdvance,
  onPrevious,
  onSubmit,
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
      onCustomAnswerChange={onCustomAnswerChange}
      onAdvance={onAdvance}
      onPrevious={onPrevious}
      onSubmit={onSubmit}
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
  onCustomAnswerChange,
  onAdvance,
  onPrevious,
  onSubmit,
}: {
  isVisible: boolean;
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onSelectOption: (questionId: string, optionLabel: string) => void;
  onCustomAnswerChange: (questionId: string, customAnswer: string) => void;
  onAdvance: () => void;
  onPrevious: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const questionCardRef = useRef<HTMLDivElement>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measuredRef = useRef(false);
  const previousQuestionIdRef = useRef<string | null>(activeQuestion?.id ?? null);

  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);
  const [trackY, setTrackY] = useState(0);
  const [animate, setAnimate] = useState(false);
  // Until the first measure, mount only the active question so the card opens at
  // its real height instead of flashing to the height of every question stacked.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const sync = useCallback(
    (withAnimation: boolean) => {
      const item = questionRefs.current[progress.questionIndex];
      if (!item) return;
      setViewportHeight(item.offsetHeight);
      setTrackY(item.offsetTop);
      setAnimate(withAnimation && !prefersReducedMotion());
    },
    [progress.questionIndex],
  );

  useLayoutEffect(() => {
    const withAnimation = measuredRef.current;
    measuredRef.current = true;
    sync(withAnimation);
    setReady(true);
  }, [sync, answers, progress.questionIndex]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => sync(measuredRef.current));
    return () => window.cancelAnimationFrame(frame);
  }, [sync]);

  // Advancing keeps focus on the card so numeric shortcuts keep working.
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
      // The last question never sends by itself: Send stays an explicit click.
      if (!shouldAutoAdvancePendingUserInput(activeQuestion) || progress.isLastQuestion) return;
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null;
        onAdvance();
      }, AUTO_ADVANCE_MS);
    },
    [
      onSelectOption,
      onAdvance,
      activeQuestion,
      progress.isLastQuestion,
      isVisible,
      isResponding,
    ],
  );

  const commit = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (progress.isLastQuestion) {
      if (progress.isComplete) onSubmit();
      return;
    }
    onAdvance();
  }, [onAdvance, onSubmit, progress.isComplete, progress.isLastQuestion]);

  // Shortcuts belong to this question card, never another tile's editor.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeQuestion) return;
    const target = event.target;
    const editing =
      target instanceof HTMLElement &&
      (target.isContentEditable || Boolean(target.closest("input, textarea")));

    if (event.key === "Enter" && !event.shiftKey && progress.canAdvance) {
      event.preventDefault();
      event.stopPropagation();
      commit();
      return;
    }

    const value = pendingUserInputShortcutValue(activeQuestion, event.key, {
      visible: isVisible,
      responding: isResponding,
      editing,
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

  const stepLabel = `${progress.questionIndex + 1} / ${prompt.questions.length}`;
  const multipleQuestions = prompt.questions.length > 1;

  return (
    <div
      ref={questionCardRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 @md/cozea-workbench-pane:px-5">
        <div
          className="overflow-hidden"
          style={{
            height: viewportHeight,
            transition: animate ? `height ${SLIDE}` : undefined,
          }}
          aria-live="polite"
        >
          <div
            className="flex flex-col gap-6"
            style={{
              transform: `translate3d(0, ${-trackY}px, 0)`,
              transition: animate ? `transform ${SLIDE}` : undefined,
              willChange: "transform",
            }}
          >
            {prompt.questions.map((question, index) => {
              const isActive = index === progress.questionIndex;
              if (!ready && !isActive) return null;
              const draft = answers[question.id];
              const selectedValues = Array.isArray(draft?.selectedOptionValues)
                ? draft.selectedOptionValues
                : [];
              const questionStyle: CSSProperties = {
                opacity: isActive ? 1 : 0,
                transition: animate ? `opacity ${SLIDE}` : undefined,
                pointerEvents: isActive ? undefined : "none",
              };
              return (
                <div
                  key={question.id}
                  ref={(element) => {
                    questionRefs.current[index] = element;
                  }}
                  aria-hidden={isActive ? undefined : true}
                  style={questionStyle}
                >
                  <span className="text-caption font-semibold text-muted-foreground/50">
                    {question.header.charAt(0).toUpperCase() +
                      question.header.slice(1).toLowerCase()}
                  </span>
                  <p className="mt-1 text-sm font-medium text-foreground/90">{question.question}</p>
                  <GlideMenu
                    rowSelector="[data-menu-row]"
                    className="mt-2.5 flex flex-col gap-1"
                    highlightClassName="rounded-lg bg-accent/50"
                  >
                    {question.options.map((option, optionIndex) => {
                      const optionValue = option.value ?? option.label;
                      const isSelected = selectedValues.includes(optionValue);
                      const shortcutKey = optionIndex < 9 ? optionIndex + 1 : null;
                      return (
                        <button
                          key={`${question.id}:${optionValue}:${optionIndex}`}
                          type="button"
                          data-menu-row
                          aria-pressed={isSelected}
                          tabIndex={isActive ? 0 : -1}
                          disabled={isResponding}
                          onClick={() => {
                            if (isActive) selectOptionAndAutoAdvance(question.id, optionValue);
                          }}
                          className={cn(
                            "relative z-10 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-150",
                            isResponding && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                              question.multiSelect ? "rounded-[5px]" : "rounded-full",
                              isSelected
                                ? "bg-foreground text-background"
                                : "text-transparent shadow-[inset_0_0_0_1.5px_var(--border)]",
                            )}
                          >
                            {question.multiSelect ? (
                              <HugeiconsIcon icon={__CheckHugeIcon} className="size-3" />
                            ) : (
                              <span
                                className="size-1.5 rounded-full bg-background transition-transform duration-200"
                                style={{ transform: isSelected ? "scale(1)" : "scale(0)" }}
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block text-sm leading-snug transition-colors duration-200",
                                isSelected ? "text-foreground" : "text-foreground/80",
                              )}
                            >
                              {option.label}
                            </span>
                            {option.description && option.description !== option.label ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground/60 line-clamp-2">
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                          {shortcutKey !== null ? (
                            <kbd className="flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-border/60 bg-background/50 text-2xs font-medium tabular-nums text-muted-foreground/50">
                              {shortcutKey}
                            </kbd>
                          ) : null}
                        </button>
                      );
                    })}

                    {question.allowCustomAnswer !== false ? (
                      <label
                        data-menu-row
                        className="relative z-10 flex items-center gap-2.5 rounded-lg px-2 py-1.5"
                      >
                        <span className="size-4 shrink-0" aria-hidden="true" />
                        <input
                          value={draft?.customAnswer ?? ""}
                          tabIndex={isActive ? 0 : -1}
                          disabled={isResponding}
                          onChange={(event) => {
                            if (!isActive) return;
                            onCustomAnswerChange(question.id, event.target.value);
                          }}
                          placeholder={t("assistant.somethingElse")}
                          aria-label={`Custom answer: ${question.question}`}
                          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                        />
                      </label>
                    ) : null}
                  </GlideMenu>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-4 py-2 @md/cozea-workbench-pane:px-5">
        <div className="flex items-center gap-1 text-muted-foreground">
          {multipleQuestions ? (
            <>
              <button
                type="button"
                aria-label={t("assistant.previousQuestion")}
                disabled={progress.questionIndex <= 0 || isResponding}
                onClick={onPrevious}
                className="flex size-[18px] items-center justify-center rounded-[5px] transition-colors duration-100 enabled:hover:text-foreground disabled:opacity-30"
              >
                <HugeiconsIcon icon={__ChevronUpHugeIcon} className="size-3.5" />
              </button>
              <span className="inline-flex items-center text-xs font-medium tabular-nums leading-none text-muted-foreground">
                <RollingDigits value={stepLabel} />
              </span>
              <button
                type="button"
                aria-label={t("assistant.nextQuestion")}
                disabled={progress.isLastQuestion || isResponding}
                onClick={onAdvance}
                className="flex size-[18px] items-center justify-center rounded-[5px] transition-colors duration-100 enabled:hover:text-foreground disabled:opacity-30"
              >
                <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3.5" />
              </button>
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {multipleQuestions && !progress.isLastQuestion ? (
            <Button
              type="button"
              variant="ghost-muted"
              size="sm"
              disabled={isResponding}
              onClick={onAdvance}
            >
              {t("assistant.skip")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={
              isResponding || (progress.isLastQuestion ? !progress.isComplete : !progress.canAdvance)
            }
            onClick={commit}
          >
            {progress.isLastQuestion ? "Send" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
});
