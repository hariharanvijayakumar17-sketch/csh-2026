/**
 * Single re-export point for zod, extended once for OpenAPI generation.
 * Every route schema MUST import `z` from here (never from "zod" directly)
 * so the zod-to-openapi extension and the schemas share one instance
 * (the bundler can otherwise create duplicate zod instances, which breaks
 * schema.openapi()).
 */
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };
