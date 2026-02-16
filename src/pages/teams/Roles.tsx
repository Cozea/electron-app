import { Fragment, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Check, X, Shield, Users, Eye, ChevronLeft, ChevronRight } from 'lucide-react'

const roles = [
  {
    id: 'admin',
    name: 'Admin',
    icon: Shield,
    description: 'Full access to workspace. Manage members, billing, and settings.',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  {
    id: 'member',
    name: 'Member',
    icon: Users,
    description: 'Create and edit projects. Collaborate with team.',
    color: 'bg-green-500/10 text-green-600 border-green-500/20',
  },
  {
    id: 'viewer',
    name: 'Viewer',
    icon: Eye,
    description: 'Read-only access to assigned projects.',
    color: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  },
]

const permissions = [
  { category: 'Organization', items: [
    { name: 'View organization', admin: true, member: true, viewer: true },
    { name: 'Edit organization settings', admin: true, member: false, viewer: false },
    { name: 'Delete organization', admin: true, member: false, viewer: false },
    { name: 'Manage billing', admin: true, member: false, viewer: false },
  ]},
  { category: 'Members', items: [
    { name: 'View members', admin: true, member: true, viewer: true },
    { name: 'Invite members', admin: true, member: false, viewer: false },
    { name: 'Remove members', admin: true, member: false, viewer: false },
    { name: 'Change member roles', admin: true, member: false, viewer: false },
  ]},
  { category: 'Projects', items: [
    { name: 'View projects', admin: true, member: true, viewer: true },
    { name: 'Create projects', admin: true, member: true, viewer: false },
    { name: 'Edit projects', admin: true, member: true, viewer: false },
    { name: 'Delete projects', admin: true, member: false, viewer: false },
    { name: 'Export projects', admin: true, member: true, viewer: false },
  ]},
  { category: 'Settings', items: [
    { name: 'View settings', admin: true, member: true, viewer: false },
    { name: 'Update settings', admin: true, member: false, viewer: false },
    { name: 'Manage API keys', admin: true, member: false, viewer: false },
  ]},
  { category: 'Integrations', items: [
    { name: 'View integrations', admin: true, member: true, viewer: false },
    { name: 'Connect integrations', admin: true, member: false, viewer: false },
    { name: 'Disconnect integrations', admin: true, member: false, viewer: false },
  ]},
  { category: 'Usage & Analytics', items: [
    { name: 'View usage', admin: true, member: true, viewer: false },
    { name: 'Export usage data', admin: true, member: false, viewer: false },
  ]},
]

export function Roles() {
  const { user, logout } = useAuth()
  const [currentPage, setCurrentPage] = useState(1)
  const categoriesPerPage = 2
  const totalPages = Math.max(1, Math.ceil(permissions.length / categoriesPerPage))
  const startIndex = (currentPage - 1) * categoriesPerPage
  const paginatedPermissions = permissions.slice(startIndex, startIndex + categoriesPerPage)

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i += 1) pages.push(i)
    } else if (currentPage <= 3) {
      pages.push(1, 2, 3, '...', totalPages)
    } else if (currentPage >= totalPages - 2) {
      pages.push(1, '...', totalPages - 2, totalPages - 1, totalPages)
    } else {
      pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
    }
    return pages
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Teams' }, { label: 'Roles' }]}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
          <p className="text-muted-foreground">
            Understand what each role can do in your workspace
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {roles.map((role) => {
            const Icon = role.icon
            return (
              <Card key={role.id} className="border-none shadow-none bg-transparent">
                <CardContent className="pt-0">
                  <div className="rounded-2xl bg-secondary/80 dark:bg-secondary/40 p-5 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${role.color}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <CardTitle className="text-base">{role.name}</CardTitle>
                    </div>
                    <p className="text-sm text-muted-foreground">{role.description}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div>
          <CardTitle className="mb-1">Permissions Matrix</CardTitle>
          <p className="mb-4 text-sm text-muted-foreground">
            Detailed breakdown of what each role can access and modify
          </p>
          <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
            <Table className="[&_th]:px-4 [&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow>
                  <TableHead className="w-[300px]">Permission</TableHead>
                  <TableHead className="text-center">
                    <Badge variant="secondary" className={roles[0].color}>
                      <Shield className="h-3 w-3 mr-1" />
                      Admin
                    </Badge>
                  </TableHead>
                  <TableHead className="text-center">
                    <Badge variant="secondary" className={roles[1].color}>
                      <Users className="h-3 w-3 mr-1" />
                      Member
                    </Badge>
                  </TableHead>
                  <TableHead className="text-center">
                    <Badge variant="secondary" className={roles[2].color}>
                      <Eye className="h-3 w-3 mr-1" />
                      Viewer
                    </Badge>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                {paginatedPermissions.map((category) => (
                  <Fragment key={category.category}>
                    <TableRow>
                      <TableCell colSpan={4} className="bg-secondary/60 font-medium">
                        {category.category}
                      </TableCell>
                    </TableRow>
                    {category.items.map((perm) => (
                      <TableRow key={perm.name}>
                        <TableCell className="text-muted-foreground">{perm.name}</TableCell>
                        <TableCell className="text-center">
                          {perm.admin ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {perm.member ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {perm.viewer ? (
                            <Check className="h-4 w-4 text-green-500 mx-auto" />
                          ) : (
                            <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing <span className="font-medium">{startIndex + 1}-{Math.min(startIndex + categoriesPerPage, permissions.length)}</span> of <span className="font-medium">{permissions.length}</span> entries
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {getPageNumbers().map((page, i) => (
                  typeof page === 'number' ? (
                    <Button
                      key={i}
                      variant={currentPage === page ? 'default' : 'secondary'}
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  ) : (
                    <span key={i} className="px-2 text-muted-foreground">...</span>
                  )
                ))}
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
