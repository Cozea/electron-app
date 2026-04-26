import { deriveDisplayedUserMessageState } from "../lib/terminalContext";
import { buildInlineTerminalContextText } from "./userMessageTerminalContexts";
import { measureTextLineCountAtWidthAtLeastOne } from "@/lib/text/pretextMeasure";

// Match timeline `text-xs leading-normal` (~12px × 1.5 line-height).
const LINE_HEIGHT_PX = 18;
const ASSISTANT_BASE_HEIGHT_PX = 72;
const USER_BASE_HEIGHT_PX = 88;
const ATTACHMENTS_PER_ROW = 2;
// Attachment thumbnails render with `max-h-[220px]` plus ~8px row gap.
const USER_ATTACHMENT_ROW_HEIGHT_PX = 228;
const USER_BUBBLE_WIDTH_RATIO = 0.8;
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 32;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
const USER_MESSAGE_FONT = "400 12px Inter";
const ASSISTANT_MESSAGE_FONT = "400 12px Inter";
const MIN_TEXT_LAYOUT_WIDTH_PX = 32;

interface TimelineMessageHeightInput {
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ReadonlyArray<{ id: string }>;
}

interface TimelineHeightEstimateLayout {
  timelineWidthPx: number | null;
}

function isFinitePositiveNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function estimateUserTextWidthPx(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return MIN_TEXT_LAYOUT_WIDTH_PX;
  const bubbleWidthPx = timelineWidthPx * USER_BUBBLE_WIDTH_RATIO;
  return Math.max(MIN_TEXT_LAYOUT_WIDTH_PX, bubbleWidthPx - USER_BUBBLE_HORIZONTAL_PADDING_PX);
}

function estimateAssistantTextWidthPx(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return MIN_TEXT_LAYOUT_WIDTH_PX;
  return Math.max(
    MIN_TEXT_LAYOUT_WIDTH_PX,
    timelineWidthPx - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX,
  );
}

export function estimateTimelineMessageHeight(
  message: TimelineMessageHeightInput,
  layout: TimelineHeightEstimateLayout = { timelineWidthPx: null },
): number {
  if (message.role === "assistant") {
    const textWidth = estimateAssistantTextWidthPx(layout.timelineWidthPx);
    const estimatedLines = measureTextLineCountAtWidthAtLeastOne(
      message.text,
      ASSISTANT_MESSAGE_FONT,
      textWidth,
      { whiteSpace: "pre-wrap" },
    );
    return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX;
  }

  if (message.role === "user") {
    const textWidth = estimateUserTextWidthPx(layout.timelineWidthPx);
    const displayedUserMessage = deriveDisplayedUserMessageState(message.text);
    const renderedText =
      displayedUserMessage.contexts.length > 0
        ? [
            buildInlineTerminalContextText(displayedUserMessage.contexts),
            displayedUserMessage.visibleText,
          ]
            .filter((part) => part.length > 0)
            .join(" ")
        : displayedUserMessage.visibleText;
    const estimatedLines = measureTextLineCountAtWidthAtLeastOne(
      renderedText,
      USER_MESSAGE_FONT,
      textWidth,
      { whiteSpace: "pre-wrap" },
    );
    const attachmentCount = message.attachments?.length ?? 0;
    const attachmentRows = Math.ceil(attachmentCount / ATTACHMENTS_PER_ROW);
    const attachmentHeight = attachmentRows * USER_ATTACHMENT_ROW_HEIGHT_PX;
    return USER_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX + attachmentHeight;
  }

  // `system` messages are not rendered in the chat timeline, but keep a stable
  // explicit branch in case they are present in timeline data.
  const textWidth = estimateAssistantTextWidthPx(layout.timelineWidthPx);
  const estimatedLines = measureTextLineCountAtWidthAtLeastOne(
    message.text,
    ASSISTANT_MESSAGE_FONT,
    textWidth,
    { whiteSpace: "pre-wrap" },
  );
  return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX;
}
