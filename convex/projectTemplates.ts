import { mutation, query } from "./_generated/server"
import { v } from "convex/values"

// ============================================
// TEMPLATE QUERIES
// ============================================

// List all active templates
export const list = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("projectTemplates")
      .withIndex("by_active_and_sort", (q) => q.eq("isActive", true))
      .collect()
  },
})

// Get template by slug
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectTemplates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first()
  },
})

// List templates by category
export const listByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectTemplates")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect()
  },
})

// ============================================
// TEMPLATE MUTATIONS (Admin only)
// ============================================

// Create a new template
export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    icon: v.string(),
    pageCount: v.number(),
    category: v.string(),
    defaultPages: v.array(
      v.object({
        name: v.string(),
        route: v.string(),
        type: v.string(),
      })
    ),
    defaultEntities: v.array(
      v.object({
        name: v.string(),
        fields: v.array(v.string()),
      })
    ),
    scaffoldPrompt: v.string(),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()

    // Check if slug is unique
    const existing = await ctx.db
      .query("projectTemplates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first()

    if (existing) {
      throw new Error("Template slug already exists")
    }

    return await ctx.db.insert("projectTemplates", {
      slug: args.slug,
      name: args.name,
      description: args.description,
      icon: args.icon,
      pageCount: args.pageCount,
      category: args.category,
      defaultPages: args.defaultPages,
      defaultEntities: args.defaultEntities,
      scaffoldPrompt: args.scaffoldPrompt,
      isActive: true,
      sortOrder: args.sortOrder ?? 100,
      createdAt: now,
      updatedAt: now,
    })
  },
})

// Update a template
export const update = mutation({
  args: {
    templateId: v.id("projectTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    category: v.optional(v.string()),
    defaultPages: v.optional(
      v.array(
        v.object({
          name: v.string(),
          route: v.string(),
          type: v.string(),
        })
      )
    ),
    defaultEntities: v.optional(
      v.array(
        v.object({
          name: v.string(),
          fields: v.array(v.string()),
        })
      )
    ),
    scaffoldPrompt: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { templateId, ...updates } = args
    const template = await ctx.db.get(templateId)
    if (!template) throw new Error("Template not found")

    const now = Date.now()
    const patchData: Record<string, unknown> = { updatedAt: now }

    if (updates.name !== undefined) patchData.name = updates.name
    if (updates.description !== undefined) patchData.description = updates.description
    if (updates.icon !== undefined) patchData.icon = updates.icon
    if (updates.pageCount !== undefined) patchData.pageCount = updates.pageCount
    if (updates.category !== undefined) patchData.category = updates.category
    if (updates.defaultPages !== undefined) patchData.defaultPages = updates.defaultPages
    if (updates.defaultEntities !== undefined) patchData.defaultEntities = updates.defaultEntities
    if (updates.scaffoldPrompt !== undefined) patchData.scaffoldPrompt = updates.scaffoldPrompt
    if (updates.isActive !== undefined) patchData.isActive = updates.isActive
    if (updates.sortOrder !== undefined) patchData.sortOrder = updates.sortOrder

    await ctx.db.patch(templateId, patchData)
  },
})

// Delete a template (soft delete by setting isActive = false)
export const deactivate = mutation({
  args: { templateId: v.id("projectTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, {
      isActive: false,
      updatedAt: Date.now(),
    })
  },
})

// ============================================
// SEED DATA
// ============================================

// Seed default templates (run once during setup)
export const seedDefaults = mutation({
  handler: async (ctx) => {
    const now = Date.now()

    const defaultTemplates = [
      {
        slug: "blank",
        name: "Blank Canvas",
        description: "Start from scratch with a minimal setup",
        icon: "⬜",
        pageCount: 0,
        category: "starter",
        defaultPages: [],
        defaultEntities: [],
        scaffoldPrompt: `Create a minimal project structure with:
- A basic homepage
- Proper project configuration
- Essential dependencies only`,
        sortOrder: 1,
      },
      {
        slug: "saas-dashboard",
        name: "SaaS Dashboard",
        description: "Auth, dashboard, settings, billing",
        icon: "📊",
        pageCount: 12,
        category: "business",
        defaultPages: [
          { name: "Login", route: "/login", type: "auth" },
          { name: "Register", route: "/register", type: "auth" },
          { name: "Dashboard", route: "/dashboard", type: "dashboard" },
          { name: "Settings", route: "/settings", type: "settings" },
          { name: "Billing", route: "/billing", type: "billing" },
          { name: "Profile", route: "/profile", type: "profile" },
        ],
        defaultEntities: [
          { name: "User", fields: ["email", "name", "avatar", "plan"] },
          { name: "Subscription", fields: ["plan", "status", "billingCycle"] },
        ],
        scaffoldPrompt: `Create a SaaS dashboard application with:
- Authentication (login, register, forgot password)
- Main dashboard with analytics overview
- User settings and profile management
- Billing/subscription management
- Responsive sidebar navigation
- Dark mode support`,
        sortOrder: 2,
      },
      {
        slug: "ecommerce",
        name: "E-commerce Store",
        description: "Products, cart, checkout",
        icon: "🛒",
        pageCount: 15,
        category: "business",
        defaultPages: [
          { name: "Home", route: "/", type: "landing" },
          { name: "Products", route: "/products", type: "list" },
          { name: "Product Detail", route: "/products/:id", type: "detail" },
          { name: "Cart", route: "/cart", type: "cart" },
          { name: "Checkout", route: "/checkout", type: "checkout" },
          { name: "Orders", route: "/orders", type: "list" },
        ],
        defaultEntities: [
          { name: "Product", fields: ["name", "description", "price", "images", "category"] },
          { name: "Cart", fields: ["items", "total", "userId"] },
          { name: "Order", fields: ["items", "status", "shipping", "payment"] },
        ],
        scaffoldPrompt: `Create an e-commerce store with:
- Product catalog with categories and filters
- Product detail pages with images and reviews
- Shopping cart functionality
- Checkout flow with payment integration
- Order history and tracking
- User accounts and wishlists`,
        sortOrder: 3,
      },
      {
        slug: "blog-cms",
        name: "Blog / CMS",
        description: "Posts, comments, content management",
        icon: "📝",
        pageCount: 6,
        category: "content",
        defaultPages: [
          { name: "Home", route: "/", type: "landing" },
          { name: "Blog", route: "/blog", type: "list" },
          { name: "Post", route: "/blog/:slug", type: "detail" },
          { name: "Categories", route: "/categories", type: "list" },
          { name: "Admin", route: "/admin", type: "admin" },
        ],
        defaultEntities: [
          { name: "Post", fields: ["title", "slug", "content", "author", "publishedAt", "category"] },
          { name: "Category", fields: ["name", "slug", "description"] },
          { name: "Comment", fields: ["content", "author", "postId", "createdAt"] },
        ],
        scaffoldPrompt: `Create a blog/CMS platform with:
- Homepage with featured posts
- Blog listing with pagination and filtering
- Individual post pages with comments
- Category organization
- Admin panel for content management
- SEO-friendly URLs and metadata`,
        sortOrder: 4,
      },
      {
        slug: "admin-dashboard",
        name: "Admin Dashboard",
        description: "Analytics, tables, charts",
        icon: "📈",
        pageCount: 8,
        category: "business",
        defaultPages: [
          { name: "Overview", route: "/", type: "dashboard" },
          { name: "Users", route: "/users", type: "table" },
          { name: "Analytics", route: "/analytics", type: "charts" },
          { name: "Reports", route: "/reports", type: "list" },
          { name: "Settings", route: "/settings", type: "settings" },
        ],
        defaultEntities: [
          { name: "User", fields: ["name", "email", "role", "status", "lastActive"] },
          { name: "Metric", fields: ["name", "value", "change", "period"] },
        ],
        scaffoldPrompt: `Create an admin dashboard with:
- Overview page with KPI cards
- Interactive charts and graphs
- Data tables with sorting, filtering, pagination
- User management section
- Settings and configuration
- Responsive design for all screen sizes`,
        sortOrder: 5,
      },
      {
        slug: "landing-page",
        name: "Landing Page",
        description: "Marketing site with CTA",
        icon: "🎯",
        pageCount: 3,
        category: "marketing",
        defaultPages: [
          { name: "Home", route: "/", type: "landing" },
          { name: "Pricing", route: "/pricing", type: "pricing" },
          { name: "Contact", route: "/contact", type: "form" },
        ],
        defaultEntities: [],
        scaffoldPrompt: `Create a marketing landing page with:
- Hero section with compelling headline
- Features/benefits section
- Social proof (testimonials, logos)
- Pricing comparison table
- Call-to-action sections
- Contact form
- Footer with links`,
        sortOrder: 6,
      },
      {
        slug: "social-network",
        name: "Social Network",
        description: "Profiles, feeds, messaging",
        icon: "💬",
        pageCount: 10,
        category: "social",
        defaultPages: [
          { name: "Feed", route: "/", type: "feed" },
          { name: "Profile", route: "/profile/:id", type: "profile" },
          { name: "Messages", route: "/messages", type: "messaging" },
          { name: "Notifications", route: "/notifications", type: "list" },
          { name: "Settings", route: "/settings", type: "settings" },
        ],
        defaultEntities: [
          { name: "User", fields: ["username", "name", "bio", "avatar", "followers"] },
          { name: "Post", fields: ["content", "author", "likes", "comments", "createdAt"] },
          { name: "Message", fields: ["content", "sender", "receiver", "read", "createdAt"] },
        ],
        scaffoldPrompt: `Create a social network platform with:
- News feed with posts
- User profiles with follow system
- Direct messaging
- Notifications
- Like and comment functionality
- Image uploads
- User search`,
        sortOrder: 7,
      },
      {
        slug: "project-management",
        name: "Project Management",
        description: "Tasks, boards, teams",
        icon: "📋",
        pageCount: 9,
        category: "productivity",
        defaultPages: [
          { name: "Dashboard", route: "/", type: "dashboard" },
          { name: "Projects", route: "/projects", type: "list" },
          { name: "Board", route: "/projects/:id/board", type: "kanban" },
          { name: "Tasks", route: "/tasks", type: "list" },
          { name: "Team", route: "/team", type: "list" },
        ],
        defaultEntities: [
          { name: "Project", fields: ["name", "description", "status", "members", "deadline"] },
          { name: "Task", fields: ["title", "description", "status", "assignee", "dueDate", "priority"] },
          { name: "Team", fields: ["name", "members"] },
        ],
        scaffoldPrompt: `Create a project management tool with:
- Project overview dashboard
- Kanban board with drag-and-drop
- Task list with filtering and sorting
- Team member management
- Due dates and priorities
- Comments and attachments
- Progress tracking`,
        sortOrder: 8,
      },
    ]

    for (const template of defaultTemplates) {
      // Check if template already exists
      const existing = await ctx.db
        .query("projectTemplates")
        .withIndex("by_slug", (q) => q.eq("slug", template.slug))
        .first()

      if (!existing) {
        await ctx.db.insert("projectTemplates", {
          ...template,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    return { success: true, count: defaultTemplates.length }
  },
})
