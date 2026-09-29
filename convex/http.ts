/**
 * HTTP endpoints GitHub calls for the cozea-source-control app.
 *
 * Configure the app with:
 * - Callback URL: https://<deployment>.convex.site/github/callback, with "Request user
 *   authorization (OAuth) during installation" and "Redirect on update" on.
 * - Webhook URL: https://<deployment>.convex.site/github/webhook, with the secret in
 *   COZEA_GITHUB_WEBHOOK_SECRET. GitHub sends installation events to every app.
 */

import { httpRouter } from "convex/server"

import { internal } from "./_generated/api"
import { httpAction } from "./_generated/server"
import { describeCallbackResult, type CallbackPageResult } from "./githubCallbackPage"

/** GitHub caps webhook payloads at 25 MB, but the installation events read here are small. */
const MAX_WEBHOOK_BYTES = 1024 * 1024

const http = httpRouter()

http.route({
  path: "/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams
    const state = params.get("state")
    const installationId = Number(params.get("installation_id"))
    const validInstallationId = Number.isSafeInteger(installationId) && installationId > 0 ? installationId : undefined
    let result: CallbackPageResult
    if (state) {
      result = await ctx.runAction(internal.githubApp.completeCallback, {
        state,
        code: params.get("code") ?? undefined,
        installationId: validInstallationId,
      })
    } else {
      // Installed from a shared link: nothing ties it to a device, but the installation counts.
      const recorded = validInstallationId
        ? await ctx.runAction(internal.githubApp.recordInstallation, { installationId: validInstallationId })
        : null
      result = recorded ? { ok: true, login: null, link: null, installedOn: recorded.accountLogin } : { ok: false, reason: "expired" }
    }
    return new Response(describeCallbackResult(result), {
      status: result.ok ? 200 : 400,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        // The URL carries GitHub's one-time code.
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      },
    })
  }),
})

http.route({
  path: "/github/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text()
    if (body.length > MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 })
    const { accepted } = await ctx.runAction(internal.githubApp.handleWebhook, {
      body,
      signature: request.headers.get("x-hub-signature-256") ?? "",
      event: request.headers.get("x-github-event") ?? "",
    })
    return new Response(null, { status: accepted ? 202 : 401 })
  }),
})

export default http
