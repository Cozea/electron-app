import { Fragment } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Check, X, Shield, Users, Eye } from 'lucide-react'

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

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Teams' }, { label: 'Roles' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
        <p className="text-muted-foreground">
          Understand what each role can do in your workspace
        </p>
      </div>

      {/* Role Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {roles.map((role) => {
          const Icon = role.icon
          return (
            <Card key={role.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${role.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{role.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{role.description}</CardDescription>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Permissions Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Permissions Matrix</CardTitle>
          <CardDescription>
            Detailed breakdown of what each role can access and modify
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
            <Table className="[&_th]:px-4 [&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow>
                  <TableHead className="w-[300px]">Permission</TableHead>
                  <TableHead className="text-center">
                    <Badge variant="outline" className={roles[0].color}>
                      <Shield className="h-3 w-3 mr-1" />
                      Admin
                    </Badge>
                  </TableHead>
                  <TableHead className="text-center">
                    <Badge variant="outline" className={roles[1].color}>
                      <Users className="h-3 w-3 mr-1" />
                      Member
                    </Badge>
                  </TableHead>
                  <TableHead className="text-center">
                    <Badge variant="outline" className={roles[2].color}>
                      <Eye className="h-3 w-3 mr-1" />
                      Viewer
                    </Badge>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                {permissions.map((category) => (
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
        </CardContent>
      </Card>
    </DashboardLayout>
  )
}
