"use client";

import * as React from "react";
import {
  Dialog as Modal,
  DialogTrigger as ModalTrigger,
  DialogContent as ModalContent,
  DialogHeader as ModalHeader,
  DialogTitle as ModalTitle,
  DialogFooter as ModalFooter,
  DialogDescription as ModalDescription,
  DialogClose as ModalClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function ModalBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="modal-body" className={cn("py-2", className)} {...props} />;
}

export {
  Modal,
  ModalTrigger,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
  ModalDescription,
  ModalClose,
};
