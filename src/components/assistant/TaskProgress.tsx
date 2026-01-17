"use client";

import {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskList,
  TaskProgressSummary,
  type TaskData,
  type TaskStatus,
} from "@/components/ai-elements/task";
import { cn } from "@/lib/utils";

export interface TaskProgressProps {
  /** List of tasks to display */
  tasks: TaskData[];
  /** Whether to show the progress summary */
  showSummary?: boolean;
  /** Optional className for styling */
  className?: string;
}

/**
 * Displays task progress for agent workflows.
 * Shows a list of tasks with their status, files affected, and completion progress.
 *
 * @example
 * ```tsx
 * <TaskProgress
 *   tasks={[
 *     { id: '1', title: 'Update authentication', status: 'completed', files: ['src/auth/login.ts'] },
 *     { id: '2', title: 'Add validation', status: 'in_progress', files: ['src/utils/validate.ts'] },
 *     { id: '3', title: 'Write tests', status: 'pending' },
 *   ]}
 *   showSummary
 * />
 * ```
 */
export function TaskProgress({
  tasks,
  showSummary = true,
  className,
}: TaskProgressProps) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {showSummary && <TaskProgressSummary tasks={tasks} />}
      <TaskList tasks={tasks} />
    </div>
  );
}

// Re-export types and components for convenience
export {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskList,
  TaskProgressSummary,
  type TaskData,
  type TaskStatus,
};

export default TaskProgress;
