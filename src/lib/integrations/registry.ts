/**
 * Integration Registry
 *
 * Defines all available integrations with their configuration,
 * authentication requirements, and CLI tools they provide.
 */

import type { IntegrationDefinition, IntegrationProvider, IntegrationCategory } from './types'

// ============================================
// Integration Definitions
// ============================================

export const INTEGRATIONS: IntegrationDefinition[] = [
  // ----------------------------------------
  // Version Control
  // ----------------------------------------
  {
    id: 'github',
    name: 'GitHub',
    description: 'Code hosting and version control with pull requests, issues, and actions',
    category: 'version_control',
    icon: 'github',
    website: 'https://github.com',
    docsUrl: 'https://docs.github.com',
    authType: 'oauth',
    oauthConfig: {
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:user', 'workflow'],
      pkce: false,
      clientIdEnvVar: 'GITHUB_CLIENT_ID',
    },
    envVarMapping: {
      accessToken: 'GITHUB_TOKEN',
    },
    tools: [
      {
        name: 'github_clone',
        displayName: 'Clone Repository',
        description: 'Clone a GitHub repository to the local filesystem',
        cliCommand: 'gh repo clone',
        cliPackage: 'gh',
        inputSchema: {
          type: 'object',
          properties: {
            repository: { type: 'string', description: 'Repository in owner/repo format' },
            directory: { type: 'string', description: 'Target directory' },
          },
          required: ['repository'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
      {
        name: 'github_pr_create',
        displayName: 'Create Pull Request',
        description: 'Create a pull request on GitHub',
        cliCommand: 'gh pr create',
        cliPackage: 'gh',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'PR title' },
            body: { type: 'string', description: 'PR description' },
            base: { type: 'string', description: 'Base branch' },
            head: { type: 'string', description: 'Head branch' },
          },
          required: ['title'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
      {
        name: 'github_issue_create',
        displayName: 'Create Issue',
        description: 'Create an issue on GitHub',
        cliCommand: 'gh issue create',
        cliPackage: 'gh',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue description' },
            labels: { type: 'array', items: { type: 'string' }, description: 'Labels' },
          },
          required: ['title'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'DevOps platform with Git hosting, CI/CD, and project management',
    category: 'version_control',
    icon: 'gitlab',
    website: 'https://gitlab.com',
    docsUrl: 'https://docs.gitlab.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'personalAccessToken',
          label: 'Personal Access Token',
          placeholder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
          helpUrl: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
          secret: true,
          required: true,
        },
        {
          name: 'gitlabUrl',
          label: 'GitLab URL',
          placeholder: 'https://gitlab.com',
          helpText: 'Leave default for GitLab.com, or enter your self-hosted URL',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      personalAccessToken: 'GITLAB_TOKEN',
      gitlabUrl: 'GITLAB_HOST',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Backend / Database
  // ----------------------------------------
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Open source Firebase alternative with Postgres, Auth, Storage, and Edge Functions',
    category: 'backend',
    icon: 'database',
    website: 'https://supabase.com',
    docsUrl: 'https://supabase.com/docs',
    setupGuideUrl: 'https://supabase.com/docs/guides/getting-started',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'url',
          label: 'Project URL',
          placeholder: 'https://your-project.supabase.co',
          helpText: 'Found in Project Settings > API',
          secret: false,
          required: true,
        },
        {
          name: 'anonKey',
          label: 'Anon/Public Key',
          placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          helpText: 'Safe to use in client-side code',
          secret: true,
          required: true,
        },
        {
          name: 'serviceRoleKey',
          label: 'Service Role Key',
          placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          helpText: 'Secret key with full access - never expose to client',
          helpUrl: 'https://supabase.com/docs/guides/api#api-keys',
          secret: true,
          required: false,
        },
      ],
    },
    envVarMapping: {
      url: 'SUPABASE_URL',
      anonKey: 'SUPABASE_ANON_KEY',
      serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY',
    },
    tools: [
      {
        name: 'supabase_db_query',
        displayName: 'Query Database',
        description: 'Execute a SQL query against the Supabase database',
        cliCommand: 'supabase db query',
        cliPackage: 'supabase',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL query to execute' },
          },
          required: ['query'],
        },
        riskLevel: 'dangerous',
        requiresApproval: true,
      },
      {
        name: 'supabase_functions_deploy',
        displayName: 'Deploy Edge Function',
        description: 'Deploy an Edge Function to Supabase',
        cliCommand: 'supabase functions deploy',
        cliPackage: 'supabase',
        inputSchema: {
          type: 'object',
          properties: {
            functionName: { type: 'string', description: 'Name of the function' },
          },
          required: ['functionName'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'firebase',
    name: 'Firebase',
    description: 'Google\'s app development platform with Firestore, Auth, Hosting, and Cloud Functions',
    category: 'backend',
    icon: 'flame',
    website: 'https://firebase.google.com',
    docsUrl: 'https://firebase.google.com/docs',
    authType: 'service_account',
    serviceAccountConfig: {
      fields: [
        {
          name: 'projectId',
          label: 'Project ID',
          placeholder: 'my-firebase-project',
          secret: false,
          required: true,
        },
      ],
      fileUpload: {
        accept: '.json',
        label: 'Service Account JSON',
      },
    },
    envVarMapping: {
      projectId: 'FIREBASE_PROJECT_ID',
      serviceAccountJson: 'GOOGLE_APPLICATION_CREDENTIALS',
    },
    tools: [
      {
        name: 'firebase_deploy',
        displayName: 'Deploy to Firebase',
        description: 'Deploy to Firebase Hosting, Functions, or Firestore rules',
        cliCommand: 'firebase deploy',
        cliPackage: 'firebase-tools',
        inputSchema: {
          type: 'object',
          properties: {
            only: { type: 'string', description: 'Deploy only specific features (hosting, functions, firestore)' },
          },
        },
        riskLevel: 'dangerous',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    description: 'Serverless MySQL platform with branching, deploy requests, and zero-downtime schema changes',
    category: 'backend',
    icon: 'database',
    website: 'https://planetscale.com',
    docsUrl: 'https://docs.planetscale.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'serviceTokenId',
          label: 'Service Token ID',
          placeholder: 'pscale_tkid_...',
          secret: false,
          required: true,
        },
        {
          name: 'serviceToken',
          label: 'Service Token',
          placeholder: 'pscale_tk_...',
          secret: true,
          required: true,
        },
        {
          name: 'organization',
          label: 'Organization',
          placeholder: 'my-org',
          secret: false,
          required: true,
        },
      ],
    },
    envVarMapping: {
      serviceTokenId: 'PLANETSCALE_SERVICE_TOKEN_ID',
      serviceToken: 'PLANETSCALE_SERVICE_TOKEN',
      organization: 'PLANETSCALE_ORG',
    },
    tools: [],
    isComingSoon: true,
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Serverless Postgres with branching, autoscaling, and bottomless storage',
    category: 'backend',
    icon: 'database',
    website: 'https://neon.tech',
    docsUrl: 'https://neon.tech/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 'neon_api_...',
          secret: true,
          required: true,
        },
        {
          name: 'connectionString',
          label: 'Connection String',
          placeholder: 'postgresql://user:pass@host/db',
          helpText: 'Pooled connection string for your database',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'NEON_API_KEY',
      connectionString: 'DATABASE_URL',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Deployment
  // ----------------------------------------
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Frontend cloud platform with automatic deployments, serverless functions, and edge runtime',
    category: 'deployment',
    icon: 'triangle',
    website: 'https://vercel.com',
    docsUrl: 'https://vercel.com/docs',
    authType: 'oauth',
    oauthConfig: {
      authUrl: 'https://vercel.com/oauth/authorize',
      tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
      scopes: [],
      pkce: true,
      clientIdEnvVar: 'VERCEL_CLIENT_ID',
    },
    envVarMapping: {
      accessToken: 'VERCEL_TOKEN',
    },
    tools: [
      {
        name: 'vercel_deploy',
        displayName: 'Deploy to Vercel',
        description: 'Deploy the current project to Vercel',
        cliCommand: 'vercel deploy',
        cliPackage: 'vercel',
        inputSchema: {
          type: 'object',
          properties: {
            prod: { type: 'boolean', description: 'Deploy to production' },
          },
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
      {
        name: 'vercel_env_add',
        displayName: 'Add Environment Variable',
        description: 'Add an environment variable to a Vercel project',
        cliCommand: 'vercel env add',
        cliPackage: 'vercel',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Variable name' },
            value: { type: 'string', description: 'Variable value' },
            environment: { type: 'string', enum: ['production', 'preview', 'development'], description: 'Target environment' },
          },
          required: ['name', 'value'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'netlify',
    name: 'Netlify',
    description: 'Web development platform with continuous deployment, serverless functions, and forms',
    category: 'deployment',
    icon: 'globe',
    website: 'https://netlify.com',
    docsUrl: 'https://docs.netlify.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'accessToken',
          label: 'Personal Access Token',
          placeholder: 'your-access-token',
          helpUrl: 'https://docs.netlify.com/api/get-started/#authentication',
          secret: true,
          required: true,
        },
        {
          name: 'siteId',
          label: 'Site ID',
          placeholder: 'your-site-id',
          helpText: 'Optional - can be auto-detected from netlify.toml',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      accessToken: 'NETLIFY_AUTH_TOKEN',
      siteId: 'NETLIFY_SITE_ID',
    },
    tools: [
      {
        name: 'netlify_deploy',
        displayName: 'Deploy to Netlify',
        description: 'Deploy the current project to Netlify',
        cliCommand: 'netlify deploy',
        cliPackage: 'netlify-cli',
        inputSchema: {
          type: 'object',
          properties: {
            prod: { type: 'boolean', description: 'Deploy to production' },
            dir: { type: 'string', description: 'Directory to deploy' },
          },
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'railway',
    name: 'Railway',
    description: 'Infrastructure platform for deploying apps, databases, and services',
    category: 'deployment',
    icon: 'train',
    website: 'https://railway.app',
    docsUrl: 'https://docs.railway.app',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiToken',
          label: 'API Token',
          placeholder: 'your-api-token',
          helpUrl: 'https://docs.railway.app/reference/public-api#creating-a-token',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiToken: 'RAILWAY_TOKEN',
    },
    tools: [
      {
        name: 'railway_deploy',
        displayName: 'Deploy to Railway',
        description: 'Deploy the current project to Railway',
        cliCommand: 'railway up',
        cliPackage: '@railway/cli',
        inputSchema: {
          type: 'object',
          properties: {
            detach: { type: 'boolean', description: 'Detach from deployment logs' },
          },
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'fly',
    name: 'Fly.io',
    description: 'Deploy app servers close to users with edge compute and global Postgres',
    category: 'deployment',
    icon: 'plane',
    website: 'https://fly.io',
    docsUrl: 'https://fly.io/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiToken',
          label: 'API Token',
          placeholder: 'fo1_...',
          helpUrl: 'https://fly.io/docs/flyctl/tokens/',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiToken: 'FLY_API_TOKEN',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Auth
  // ----------------------------------------
  {
    id: 'clerk',
    name: 'Clerk',
    description: 'Complete user management with authentication, profiles, and organizations',
    category: 'auth',
    icon: 'user-check',
    website: 'https://clerk.com',
    docsUrl: 'https://clerk.com/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'secretKey',
          label: 'Secret Key',
          placeholder: 'sk_live_...',
          helpText: 'Found in Clerk Dashboard > API Keys',
          secret: true,
          required: true,
        },
        {
          name: 'publishableKey',
          label: 'Publishable Key',
          placeholder: 'pk_live_...',
          helpText: 'Safe for client-side use',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      secretKey: 'CLERK_SECRET_KEY',
      publishableKey: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    },
    tools: [],
  },
  {
    id: 'auth0',
    name: 'Auth0',
    description: 'Identity platform for authentication, authorization, and user management',
    category: 'auth',
    icon: 'shield',
    website: 'https://auth0.com',
    docsUrl: 'https://auth0.com/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'domain',
          label: 'Domain',
          placeholder: 'your-tenant.auth0.com',
          secret: false,
          required: true,
        },
        {
          name: 'clientId',
          label: 'Client ID',
          placeholder: 'your-client-id',
          secret: false,
          required: true,
        },
        {
          name: 'clientSecret',
          label: 'Client Secret',
          placeholder: 'your-client-secret',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      domain: 'AUTH0_DOMAIN',
      clientId: 'AUTH0_CLIENT_ID',
      clientSecret: 'AUTH0_CLIENT_SECRET',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Payments
  // ----------------------------------------
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing with subscriptions, invoicing, and financial infrastructure',
    category: 'payments',
    icon: 'credit-card',
    website: 'https://stripe.com',
    docsUrl: 'https://stripe.com/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'secretKey',
          label: 'Secret Key',
          placeholder: 'sk_live_...',
          helpText: 'Use sk_test_... for testing',
          helpUrl: 'https://stripe.com/docs/keys',
          secret: true,
          required: true,
        },
        {
          name: 'publishableKey',
          label: 'Publishable Key',
          placeholder: 'pk_live_...',
          helpText: 'Safe for client-side use',
          secret: false,
          required: false,
        },
        {
          name: 'webhookSecret',
          label: 'Webhook Secret',
          placeholder: 'whsec_...',
          helpText: 'For verifying webhook signatures',
          secret: true,
          required: false,
        },
      ],
    },
    envVarMapping: {
      secretKey: 'STRIPE_SECRET_KEY',
      publishableKey: 'STRIPE_PUBLISHABLE_KEY',
      webhookSecret: 'STRIPE_WEBHOOK_SECRET',
    },
    tools: [
      {
        name: 'stripe_listen',
        displayName: 'Listen for Webhooks',
        description: 'Forward webhook events to your local server',
        cliCommand: 'stripe listen',
        cliPackage: 'stripe',
        inputSchema: {
          type: 'object',
          properties: {
            forwardTo: { type: 'string', description: 'URL to forward events to' },
          },
          required: ['forwardTo'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
    ],
  },

  // ----------------------------------------
  // Email
  // ----------------------------------------
  {
    id: 'resend',
    name: 'Resend',
    description: 'Modern email API built for developers with React Email support',
    category: 'email',
    icon: 'mail',
    website: 'https://resend.com',
    docsUrl: 'https://resend.com/docs',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 're_...',
          helpUrl: 'https://resend.com/api-keys',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'RESEND_API_KEY',
    },
    tools: [],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery and marketing platform with templates and analytics',
    category: 'email',
    icon: 'send',
    website: 'https://sendgrid.com',
    docsUrl: 'https://docs.sendgrid.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 'SG...',
          helpUrl: 'https://docs.sendgrid.com/ui/account-and-settings/api-keys',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'SENDGRID_API_KEY',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Storage
  // ----------------------------------------
  {
    id: 'aws',
    name: 'AWS',
    description: 'Amazon Web Services for S3 storage, Lambda, DynamoDB, and more',
    category: 'storage',
    icon: 'cloud',
    website: 'https://aws.amazon.com',
    docsUrl: 'https://docs.aws.amazon.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'accessKeyId',
          label: 'Access Key ID',
          placeholder: 'AKIA...',
          secret: false,
          required: true,
        },
        {
          name: 'secretAccessKey',
          label: 'Secret Access Key',
          placeholder: 'your-secret-access-key',
          secret: true,
          required: true,
        },
        {
          name: 'region',
          label: 'Default Region',
          placeholder: 'us-east-1',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      accessKeyId: 'AWS_ACCESS_KEY_ID',
      secretAccessKey: 'AWS_SECRET_ACCESS_KEY',
      region: 'AWS_REGION',
    },
    tools: [
      {
        name: 'aws_s3_sync',
        displayName: 'Sync to S3',
        description: 'Sync local files to an S3 bucket',
        cliCommand: 'aws s3 sync',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Local source directory' },
            destination: { type: 'string', description: 'S3 destination (s3://bucket/path)' },
          },
          required: ['source', 'destination'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Edge network with R2 storage, Workers, KV, and D1 database',
    category: 'storage',
    icon: 'cloud',
    website: 'https://cloudflare.com',
    docsUrl: 'https://developers.cloudflare.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiToken',
          label: 'API Token',
          placeholder: 'your-api-token',
          helpUrl: 'https://developers.cloudflare.com/fundamentals/api/get-started/create-token/',
          secret: true,
          required: true,
        },
        {
          name: 'accountId',
          label: 'Account ID',
          placeholder: 'your-account-id',
          helpText: 'Found in the Cloudflare dashboard URL',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      apiToken: 'CLOUDFLARE_API_TOKEN',
      accountId: 'CLOUDFLARE_ACCOUNT_ID',
    },
    tools: [
      {
        name: 'wrangler_deploy',
        displayName: 'Deploy Worker',
        description: 'Deploy a Cloudflare Worker',
        cliCommand: 'wrangler deploy',
        cliPackage: 'wrangler',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Worker name' },
          },
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },

  // ----------------------------------------
  // Collaboration
  // ----------------------------------------
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project management for software teams',
    category: 'collaboration',
    icon: 'layout-list',
    website: 'https://linear.app',
    docsUrl: 'https://developers.linear.app',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 'lin_api_...',
          helpUrl: 'https://linear.app/settings/api',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'LINEAR_API_KEY',
    },
    tools: [],
    isComingSoon: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team messaging with channels, workflows, and app integrations',
    category: 'collaboration',
    icon: 'message-square',
    website: 'https://slack.com',
    docsUrl: 'https://api.slack.com',
    authType: 'oauth',
    oauthConfig: {
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: ['chat:write', 'channels:read'],
      pkce: false,
      clientIdEnvVar: 'SLACK_CLIENT_ID',
    },
    envVarMapping: {
      accessToken: 'SLACK_BOT_TOKEN',
    },
    tools: [],
    isComingSoon: true,
  },

  // ----------------------------------------
  // Work OS
  // ----------------------------------------
  {
    id: 'notion',
    name: 'Notion',
    description: 'All-in-one workspace for notes, docs, wikis, and project management',
    category: 'work_os',
    icon: 'book-open',
    website: 'https://notion.so',
    docsUrl: 'https://developers.notion.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'Internal Integration Token',
          placeholder: 'secret_...',
          helpText: 'Create an integration at notion.so/my-integrations',
          helpUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'NOTION_API_KEY',
    },
    tools: [
      {
        name: 'notion_search',
        displayName: 'Search Notion',
        description: 'Search for pages and databases in Notion',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
      {
        name: 'notion_create_page',
        displayName: 'Create Page',
        description: 'Create a new page in Notion',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            parentId: { type: 'string', description: 'Parent page or database ID' },
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'Page content' },
          },
          required: ['parentId', 'title'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Flexible database-spreadsheet hybrid for organizing data and workflows',
    category: 'work_os',
    icon: 'table',
    website: 'https://airtable.com',
    docsUrl: 'https://airtable.com/developers',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'Personal Access Token',
          placeholder: 'pat...',
          helpText: 'Create a token at airtable.com/create/tokens',
          helpUrl: 'https://airtable.com/developers/web/guides/personal-access-tokens',
          secret: true,
          required: true,
        },
        {
          name: 'baseId',
          label: 'Base ID',
          placeholder: 'app...',
          helpText: 'Found in the URL when viewing your base',
          secret: false,
          required: false,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'AIRTABLE_API_KEY',
      baseId: 'AIRTABLE_BASE_ID',
    },
    tools: [
      {
        name: 'airtable_list_records',
        displayName: 'List Records',
        description: 'List records from an Airtable table',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: { type: 'string', description: 'Table ID or name' },
            maxRecords: { type: 'number', description: 'Maximum records to return' },
          },
          required: ['tableId'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
      {
        name: 'airtable_create_record',
        displayName: 'Create Record',
        description: 'Create a new record in an Airtable table',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            tableId: { type: 'string', description: 'Table ID or name' },
            fields: { type: 'object', description: 'Field values for the record' },
          },
          required: ['tableId', 'fields'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'monday',
    name: 'Monday.com',
    description: 'Work management platform with customizable workflows and automations',
    category: 'work_os',
    icon: 'kanban',
    website: 'https://monday.com',
    docsUrl: 'https://developer.monday.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 'your-api-key',
          helpText: 'Find your API key in Admin > Integrations > Developers',
          helpUrl: 'https://developer.monday.com/apps/docs/authentication',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'MONDAY_API_KEY',
    },
    tools: [
      {
        name: 'monday_list_boards',
        displayName: 'List Boards',
        description: 'List all boards accessible to the user',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
      {
        name: 'monday_create_item',
        displayName: 'Create Item',
        description: 'Create a new item on a Monday.com board',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            boardId: { type: 'string', description: 'Board ID' },
            itemName: { type: 'string', description: 'Name of the item' },
            columnValues: { type: 'object', description: 'Column values' },
          },
          required: ['boardId', 'itemName'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Project and task management for teams with timelines and workload views',
    category: 'work_os',
    icon: 'list-checks',
    website: 'https://asana.com',
    docsUrl: 'https://developers.asana.com',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'accessToken',
          label: 'Personal Access Token',
          placeholder: '1/...',
          helpText: 'Generate at app.asana.com/0/developer-console',
          helpUrl: 'https://developers.asana.com/docs/personal-access-token',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      accessToken: 'ASANA_ACCESS_TOKEN',
    },
    tools: [
      {
        name: 'asana_list_tasks',
        displayName: 'List Tasks',
        description: 'List tasks from an Asana project',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['projectId'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
      {
        name: 'asana_create_task',
        displayName: 'Create Task',
        description: 'Create a new task in an Asana project',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Project ID' },
            name: { type: 'string', description: 'Task name' },
            notes: { type: 'string', description: 'Task description' },
          },
          required: ['projectId', 'name'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Productivity platform with tasks, docs, goals, and time tracking',
    category: 'work_os',
    icon: 'check-square',
    website: 'https://clickup.com',
    docsUrl: 'https://clickup.com/api',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Key',
          placeholder: 'pk_...',
          helpText: 'Find your API key in Settings > Apps',
          helpUrl: 'https://clickup.com/api/developer-portal/authentication/',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'CLICKUP_API_KEY',
    },
    tools: [
      {
        name: 'clickup_list_tasks',
        displayName: 'List Tasks',
        description: 'List tasks from a ClickUp list',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            listId: { type: 'string', description: 'List ID' },
          },
          required: ['listId'],
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
      {
        name: 'clickup_create_task',
        displayName: 'Create Task',
        description: 'Create a new task in a ClickUp list',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {
            listId: { type: 'string', description: 'List ID' },
            name: { type: 'string', description: 'Task name' },
            description: { type: 'string', description: 'Task description' },
          },
          required: ['listId', 'name'],
        },
        riskLevel: 'moderate',
        requiresApproval: true,
      },
    ],
  },
  {
    id: 'coda',
    name: 'Coda',
    description: 'All-in-one doc with powerful building blocks for teams',
    category: 'work_os',
    icon: 'file-text',
    website: 'https://coda.io',
    docsUrl: 'https://coda.io/developers',
    authType: 'api_key',
    apiKeyConfig: {
      fields: [
        {
          name: 'apiKey',
          label: 'API Token',
          placeholder: 'your-api-token',
          helpText: 'Generate at coda.io/account under API settings',
          helpUrl: 'https://coda.io/developers/apis/v1',
          secret: true,
          required: true,
        },
      ],
    },
    envVarMapping: {
      apiKey: 'CODA_API_KEY',
    },
    tools: [
      {
        name: 'coda_list_docs',
        displayName: 'List Docs',
        description: 'List all Coda docs accessible to the user',
        cliCommand: 'curl',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        riskLevel: 'safe',
        requiresApproval: false,
      },
    ],
    isComingSoon: true,
  },
]

// ============================================
// Registry Helpers
// ============================================

/**
 * Get an integration definition by provider ID
 */
export function getIntegration(provider: IntegrationProvider): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((i) => i.id === provider)
}

/**
 * Get all integrations for a category
 */
export function getIntegrationsByCategory(category: IntegrationCategory): IntegrationDefinition[] {
  return INTEGRATIONS.filter((i) => i.category === category)
}

/**
 * Get all available (not coming soon) integrations
 */
export function getAvailableIntegrations(): IntegrationDefinition[] {
  return INTEGRATIONS.filter((i) => !i.isComingSoon)
}

/**
 * Get all integrations grouped by category
 */
export function getIntegrationsGroupedByCategory(): Record<IntegrationCategory, IntegrationDefinition[]> {
  const grouped: Record<IntegrationCategory, IntegrationDefinition[]> = {
    version_control: [],
    backend: [],
    deployment: [],
    auth: [],
    payments: [],
    email: [],
    storage: [],
    collaboration: [],
    work_os: [],
  }

  for (const integration of INTEGRATIONS) {
    grouped[integration.category].push(integration)
  }

  return grouped
}

/**
 * Get category display info
 */
export const CATEGORY_INFO: Record<IntegrationCategory, { label: string; description: string }> = {
  version_control: { label: 'Version Control', description: 'Git hosting and collaboration' },
  backend: { label: 'Backend & Database', description: 'Databases, serverless, and BaaS' },
  deployment: { label: 'Deployment', description: 'Hosting and deployment platforms' },
  auth: { label: 'Authentication', description: 'User authentication and identity' },
  payments: { label: 'Payments', description: 'Payment processing and billing' },
  email: { label: 'Email', description: 'Transactional and marketing email' },
  storage: { label: 'Storage', description: 'File storage and CDN' },
  collaboration: { label: 'Collaboration', description: 'Team communication and project management' },
  work_os: { label: 'Work OS', description: 'Knowledge management and productivity platforms' },
}
