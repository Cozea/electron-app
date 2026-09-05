import { makeFunctionReference, type FunctionReference } from "convex/server"
import type { Id } from "../_generated/dataModel"

export const deliverPublicationReference = makeFunctionReference<"action", { publicationId: Id<"collaborationPublications"> }, null>("collaborationPublications:deliver") as unknown as FunctionReference<"action", "internal", { publicationId: Id<"collaborationPublications"> }, null>
