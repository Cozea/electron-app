import { QueryClient } from "@tanstack/query-core";
import { patchQueryClient } from "__COZEA_NATIVE_PREVIEW_lib__/plugins/react-query/patchQueryClient";

patchQueryClient(QueryClient.prototype);
