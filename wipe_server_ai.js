const fs = require('fs');

let c = fs.readFileSync('server/src/lib/convex.ts', 'utf8');

c = c.replace(/export interface ModelRegistrySnapshotForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function syncModelRegistrySnapshotForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function getLatestModelRegistrySnapshotForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function updateOrganizationAiSettings[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function reserveWalletForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function captureWalletHoldForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function releaseWalletHoldForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function getWalletForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function grantIncludedBalanceForServer[\s\S]*?\}\s*\}/g, '');
c = c.replace(/export async function revokeIncludedBalanceForServer[\s\S]*?\}\s*\}/g, '');

fs.writeFileSync('server/src/lib/convex.ts', c);

let s = fs.readFileSync('server/src/routes/settings.ts', 'utf8');

s = s.replace(/import \{[\s\n]*updateOrganizationAiSettings,[\s\S]*?\} from '\.\.\/lib\/convex\.js'/g, "import { getOrganizationByWorkosId, getOrganizationMembers, getUserById } from '../lib/convex.js'");
s = s.replace(/updateOrganizationAiSettings,/g, '');

const aiSettingsBlock1 = `const getAiSettingsContext = async (
    request: FastifyRequest<{ Params: { organizationId: string } }>,
    reply: FastifyReply
  ) => {
    const { organizationId } = request.params
    const access = await resolveWorkspaceAccess(request, reply, organizationId, [
      'workspace_ai:view',
      'workspace_ai:manage_settings',
      'workspace_ai:manage_model_policy',
      'workspace_ai:manage_provider_policy',
      'workspace_ai:view_usage',
    ])
    if (!access.ok) return reply.status(access.statusCode).send(access.body)

    const [usageSummary, recentUsage, modelsResponse] = await Promise.all([
      resolveOrganizationAiUsageSummary(organizationId),
      resolveOrganizationRecentAiUsage(organizationId),
      fastify.inject({
        method: 'GET',
        url: \`/ai/models?organizationId=\${encodeURIComponent(organizationId)}\`,
        headers: {
          authorization: request.headers.authorization,
        },
      }),
    ])

    const modelsPayload = parseJsonPayload(modelsResponse.payload) as
      | { models?: unknown[]; error?: string }
      | undefined

    return {
      organization: {
        id: access.organization.workosId,
        name: access.organization.name,
        slug: access.organization.slug,
      },
      aiSettings: access.organization.aiSettings || null,
      usageSummary,
      recentUsage,
      models: Array.isArray(modelsPayload?.models) ? modelsPayload.models : [],
      modelsError: modelsPayload?.error,
    }
  }

  fastify.get<{ Params: { organizationId: string } }>('/workspace/ai', getAiSettingsContext)`;

s = s.replace(aiSettingsBlock1, '');

const aiSettingsBlock2 = `const patchAiSettings = async (
    request: FastifyRequest<{
      Params: { organizationId: string }
      Body: {
        aiSettings?: {
          allowedProviders?: string[]
          allowedModels?: string[]
          allowProviderTools?: boolean
          allowWebSearch?: boolean
          maxReasoningDepth?: 'low' | 'medium' | 'high'
          monthlySpendingCapCents?: number | null
          defaultModelTier?: 'fast' | 'standard' | 'powerful'
        }
      }
    }>,
    reply: FastifyReply
  ) => {
    const { organizationId } = request.params
    const access = await resolveWorkspaceAccess(request, reply, organizationId, [
      'workspace_ai:manage_settings',
      'workspace_ai:manage_model_policy',
      'workspace_ai:manage_provider_policy',
    ])
    if (!access.ok) return reply.status(access.statusCode).send(access.body)

    const currentSettings = access.organization.aiSettings || {
      allowedProviders: ['anthropic', 'openai', 'google'],
    }
    const incoming = request.body.aiSettings || {}

    const mergedSettings = {
      ...currentSettings,
      ...incoming,
    }

    const updatedOrg = await updateOrganizationAiSettings({
      organizationId: access.organization._id,
      aiSettings: mergedSettings,
    })

    return {
      success: true,
      aiSettings: updatedOrg?.aiSettings || null,
    }
  }

  fastify.patch<{
    Params: { organizationId: string }
    Body: {
      aiSettings?: {
        allowedProviders?: string[]
        allowedModels?: string[]
        allowProviderTools?: boolean
        allowWebSearch?: boolean
        maxReasoningDepth?: 'low' | 'medium' | 'high'
        monthlySpendingCapCents?: number | null
        defaultModelTier?: 'fast' | 'standard' | 'powerful'
      }
    }
  }>('/workspace/ai/settings', patchAiSettings)`;

s = s.replace(aiSettingsBlock2, '');

fs.writeFileSync('server/src/routes/settings.ts', s);
