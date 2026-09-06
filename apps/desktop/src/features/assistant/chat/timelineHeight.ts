import { deriveDisplayedUserMessageState } from "../lib/terminalContext";
import { buildInlineTerminalContextText } from "./userMessageTerminalContexts";
import { measureTextLineCountAtWidthAtLeastOne } from "@/lib/text/pretextMeasure";

// Match timeline `text-xs leading-normal` (~12px × 1.5 line-height).
const LINE_HEIGHT_PX = 18;
const ASSISTANT_BASE_HEIGHT_PX = 72;
const USER_BASE_HEIGHT_PX = 88;
const TIMELINE_MAX_CONTENT_WIDTH_PX = 768;
const TIMELINE_NARROW_HORIZONTAL_PADDING_PX = 24;
const TIMELINE_WIDE_HORIZONTAL_PADDING_PX = 40;
const TIMELINE_SM_BREAKPOINT_PX = 640;
const USER_BUBBLE_NARROW_WIDTH_RATIO = 0.85;
const USER_BUBBLE_WIDE_WIDTH_RATIO = 0.75;
const USER_BUBBLE_HORIZONTAL_PADDING_PX = 32;
const ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX = 8;
// MessageAttachments renders fixed `h-24 w-32` thumbnails with `gap-2` and
// `mb-1`. Keep the estimate tied to those real dimensions so LegendList does
// not correct a stale 220px-thumbnail assumption after first paint.
const ATTACHMENT_CARD_WIDTH_PX = 128;
const ATTACHMENT_CARD_HEIGHT_PX = 96;
const ATTACHMENT_GAP_PX = 8;
const ATTACHMENT_MARGIN_BOTTOM_PX = 4;
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

function estimateTimelineContentWidthPx(timelineWidthPx: number | null): number {
  if (!isFinitePositiveNumber(timelineWidthPx)) return MIN_TEXT_LAYOUT_WIDTH_PX;
  const horizontalPadding =
    timelineWidthPx >= TIMELINE_SM_BREAKPOINT_PX
      ? TIMELINE_WIDE_HORIZONTAL_PADDING_PX
      : TIMELINE_NARROW_HORIZONTAL_PADDING_PX;
  return Math.max(
    MIN_TEXT_LAYOUT_WIDTH_PX,
    Math.min(TIMELINE_MAX_CONTENT_WIDTH_PX, timelineWidthPx - horizontalPadding),
  );
}

function estimateUserBubbleWidthPx(timelineWidthPx: number | null): number {
  const contentWidthPx = estimateTimelineContentWidthPx(timelineWidthPx);
  if (!isFinitePositiveNumber(timelineWidthPx)) return contentWidthPx;
  const widthRatio =
    timelineWidthPx >= TIMELINE_SM_BREAKPOINT_PX
      ? USER_BUBBLE_WIDE_WIDTH_RATIO
      : USER_BUBBLE_NARROW_WIDTH_RATIO;
  return Math.max(MIN_TEXT_LAYOUT_WIDTH_PX, contentWidthPx * widthRatio);
}

function estimateUserTextWidthPx(timelineWidthPx: number | null): number {
  return Math.max(
    MIN_TEXT_LAYOUT_WIDTH_PX,
    estimateUserBubbleWidthPx(timelineWidthPx) - USER_BUBBLE_HORIZONTAL_PADDING_PX,
  );
}

function estimateAssistantTextWidthPx(timelineWidthPx: number | null): number {
  return Math.max(
    MIN_TEXT_LAYOUT_WIDTH_PX,
    estimateTimelineContentWidthPx(timelineWidthPx) - ASSISTANT_MESSAGE_HORIZONTAL_PADDING_PX,
  );
}

function estimateAttachmentGalleryHeightPx(
  attachmentCount: number,
  availableWidthPx: number,
): number {
  if (attachmentCount <= 0) return 0;
  const cardsPerRow = Math.max(
    1,
    Math.floor(
      (Math.max(ATTACHMENT_CARD_WIDTH_PX, availableWidthPx) + ATTACHMENT_GAP_PX) /
        (ATTACHMENT_CARD_WIDTH_PX + ATTACHMENT_GAP_PX),
    ),
  );
  const rows = Math.ceil(attachmentCount / cardsPerRow);
  return (
    rows * ATTACHMENT_CARD_HEIGHT_PX +
    Math.max(0, rows - 1) * ATTACHMENT_GAP_PX +
    ATTACHMENT_MARGIN_BOTTOM_PX
  );
}

/** Pure attachment geometry used by the renderer estimate and Node-side tests. */
export function estimateTimelineAttachmentGalleryHeight(
  role: "user" | "assistant",
  attachmentCount: number,
  timelineWidthPx: number | null,
): number {
  const availableWidthPx =
    role === "user"
      ? estimateUserBubbleWidthPx(timelineWidthPx)
      : estimateTimelineContentWidthPx(timelineWidthPx);
  return estimateAttachmentGalleryHeightPx(attachmentCount, availableWidthPx);
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
    const attachmentHeight = estimateTimelineAttachmentGalleryHeight(
      "assistant",
      message.attachments?.length ?? 0,
      layout.timelineWidthPx,
    );
    return ASSISTANT_BASE_HEIGHT_PX + estimatedLines * LINE_HEIGHT_PX + attachmentHeight;
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
    const attachmentHeight = estimateTimelineAttachmentGalleryHeight(
      "user",
      message.attachments?.length ?? 0,
      layout.timelineWidthPx,
    );
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
