"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleIcon,
  FileIcon,
  FolderIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { createContext, memo, useContext, useState } from "react";

/**
 * Task status
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "error";

/**
 * Task data structure
 */
export interface TaskData {
  id: string;
  title: string;
  status: TaskStatus;
  files?: string[];
  details?: ReactNode;
}

type TaskContextValue = {
  status: TaskStatus;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
};

const TaskContext = createContext<TaskContextValue | null>(null);

export const useTask = () => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("Task components must be used within Task");
  }
  return context;
};

export type TaskProps = ComponentProps<typeof Collapsible> & {
  /** Task status */
  status?: TaskStatus;
};

/**
 * Container for a task item with collapsible details.
 *
 * @example
 * ```tsx
 * <Task status="in_progress">
 *   <TaskTrigger title="Update authentication module" />
 *   <TaskContent>
 *     <TaskItem>
 *       <TaskItemFile>src/auth/login.ts</TaskItemFile>
 *     </TaskItem>
 *   </TaskContent>
 * </Task>
 * ```
 */
export const Task = memo(
  ({
    className,
    status = "pending",
    defaultOpen = false,
    children,
    ...props
  }: TaskProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
      <TaskContext.Provider value={{ status, isOpen, setIsOpen }}>
        <Collapsible
          className={cn(
            "rounded-md border",
            status === "in_progress" && "border-blue-500/50 bg-blue-500/5",
            status === "completed" && "border-green-500/30",
            status === "error" && "border-red-500/50 bg-red-500/5",
            className
          )}
          open={isOpen}
          onOpenChange={setIsOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </TaskContext.Provider>
    );
  }
);

Task.displayName = "Task";

// Status icon component
const TaskStatusIcon = ({ status }: { status: TaskStatus }) => {
  switch (status) {
    case "pending":
      return <CircleIcon className="size-4 text-muted-foreground" />;
    case "in_progress":
      return (
        <Loader2Icon className="size-4 animate-spin text-blue-500" />
      );
    case "completed":
      return <CheckCircleIcon className="size-4 text-green-500" />;
    case "error":
      return <XCircleIcon className="size-4 text-red-500" />;
    default:
      return <CircleIcon className="size-4 text-muted-foreground" />;
  }
};

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  /** Task title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
};

/**
 * Trigger button to expand/collapse task details
 */
export const TaskTrigger = memo(
  ({ className, title, subtitle, ...props }: TaskTriggerProps) => {
    const { status, isOpen } = useTask();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50",
          className
        )}
        {...props}
      >
        <TaskStatusIcon status={status} />
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-sm font-medium",
              status === "completed" && "text-muted-foreground line-through"
            )}
          >
            {title}
          </span>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">
              {subtitle}
            </p>
          )}
        </div>
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isOpen && "rotate-90"
          )}
        />
      </CollapsibleTrigger>
    );
  }
);

TaskTrigger.displayName = "TaskTrigger";

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

/**
 * Collapsible content area for task details
 */
export const TaskContent = memo(
  ({ className, children, ...props }: TaskContentProps) => (
    <CollapsibleContent
      className={cn(
        "border-t px-3 pb-3 pt-2",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
);

TaskContent.displayName = "TaskContent";

export type TaskItemProps = HTMLAttributes<HTMLDivElement>;

/**
 * Individual item within task content (e.g., file, action)
 */
export const TaskItem = memo(
  ({ className, children, ...props }: TaskItemProps) => (
    <div
      className={cn(
        "flex items-center gap-2 py-1 text-sm text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);

TaskItem.displayName = "TaskItem";

export type TaskItemFileProps = HTMLAttributes<HTMLSpanElement> & {
  /** Whether this is a folder */
  isFolder?: boolean;
};

/**
 * File/folder reference within a task
 */
export const TaskItemFile = memo(
  ({ className, isFolder, children, ...props }: TaskItemFileProps) => (
    <span
      className={cn(
        "flex items-center gap-1.5 font-mono text-xs",
        className
      )}
      {...props}
    >
      {isFolder ? (
        <FolderIcon className="size-3.5" />
      ) : (
        <FileIcon className="size-3.5" />
      )}
      {children}
    </span>
  )
);

TaskItemFile.displayName = "TaskItemFile";

// Task list container component
export type TaskListProps = HTMLAttributes<HTMLDivElement> & {
  /** List of tasks to display */
  tasks?: TaskData[];
};

/**
 * Container for a list of tasks
 */
export const TaskList = memo(
  ({ className, tasks = [], children, ...props }: TaskListProps) => (
    <div className={cn("space-y-2", className)} {...props}>
      {tasks.length > 0
        ? tasks.map((task) => (
            <Task key={task.id} status={task.status}>
              <TaskTrigger title={task.title} />
              {(task.files || task.details) && (
                <TaskContent>
                  {task.files?.map((file) => (
                    <TaskItem key={file}>
                      <TaskItemFile>{file}</TaskItemFile>
                    </TaskItem>
                  ))}
                  {task.details}
                </TaskContent>
              )}
            </Task>
          ))
        : children}
    </div>
  )
);

TaskList.displayName = "TaskList";

// Progress summary component
export type TaskProgressSummaryProps = HTMLAttributes<HTMLDivElement> & {
  tasks: TaskData[];
};

/**
 * Shows summary of task progress
 */
export const TaskProgressSummary = memo(
  ({ className, tasks, ...props }: TaskProgressSummaryProps) => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const errors = tasks.filter((t) => t.status === "error").length;
    const total = tasks.length;

    return (
      <div
        className={cn(
          "flex items-center gap-4 text-xs text-muted-foreground",
          className
        )}
        {...props}
      >
        <span>{completed}/{total} completed</span>
        {inProgress > 0 && (
          <span className="text-blue-500">{inProgress} in progress</span>
        )}
        {errors > 0 && (
          <span className="text-red-500">{errors} failed</span>
        )}
      </div>
    );
  }
);

TaskProgressSummary.displayName = "TaskProgressSummary";
