import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PieChart, Pie, Cell } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, Building2, CalendarDays, Shield, Trash2, UserPlus, Check } from "lucide-react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import SuperAdminAccounts from "./SuperAdminAccounts";

const COLORS = [
  "hsl(262, 83%, 58%)",
  "hsl(152, 69%, 40%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)",
  "hsl(200, 70%, 50%)",
  "hsl(320, 70%, 50%)",
];

type AppRole = "super_admin" | "salon_owner" | "staff" | "customer";

interface UserWithRoles {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  roles: AppRole[];
  organization_name: string | null;
}

interface PendingSignup {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { invokeFunction, hasRole } = useAuth();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Pending signups (super_admin only)
  const { data: pendingSignups = [], refetch: refetchPending } = useQuery({
    queryKey: ["admin-pending-signups"],
    queryFn: async () => {
      if (!hasRole("super_admin")) return [];
      const data = await invokeFunction("get-pending-signups");
      return (data?.pending || []) as PendingSignup[];
    },
    enabled: hasRole("super_admin"),
  });

  const approveUser = useMutation({
    mutationFn: async (userId: string) => {
      await invokeFunction("approve-user", { user_id: userId });
    },
    onMutate: (userId) => setApprovingId(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pending-signups"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      toast({ title: "User approved", description: "They can now sign in. A confirmation email was sent." });
      setApprovingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to approve", description: err?.message, variant: "destructive" });
      setApprovingId(null);
    },
  });

  // Fetch all profiles + roles + organizations
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [profilesRes, rolesRes, orgsRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
        supabase.from("organizations").select("id, name, owner_id"),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;

      const roles = rolesRes.data || [];
      const orgs = orgsRes.data || [];

      return (profilesRes.data || []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        created_at: p.created_at,
        roles: roles.filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
        organization_name: orgs.find((o) => o.owner_id === p.id)?.name || null,
      })) as UserWithRoles[];
    },
  });

  // Platform-wide stats
  const { data: platformStats } = useQuery({
    queryKey: ["admin-platform-stats"],
    queryFn: async () => {
      const [profilesRes, rolesRes, orgsRes, staffRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact" }),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("organizations").select("id, owner_id"),
        supabase.from("staff").select("id, organization_id"),
      ]);

      if (profilesRes.error) throw profilesRes.error;
      if (rolesRes.error) throw rolesRes.error;
      if (orgsRes.error) throw orgsRes.error;
      if (staffRes.error) throw staffRes.error;

      const profileIds = new Set((profilesRes.data || []).map((p) => p.id));
      const superAdminIds = new Set(
        (rolesRes.data || []).filter((r) => r.role === "super_admin").map((r) => r.user_id)
      );
      const activeOwnerIds = new Set(
        (rolesRes.data || [])
          .filter((r) => r.role === "salon_owner" && profileIds.has(r.user_id) && !superAdminIds.has(r.user_id))
          .map((r) => r.user_id)
      );

      const activeOrgIds = (orgsRes.data || [])
        .filter((org) => activeOwnerIds.has(org.owner_id))
        .map((org) => org.id);
      const activeOrgSet = new Set(activeOrgIds);

      const { data: bookingsData = [], count: bookingsCount = 0, error: bookingsErr } =
        activeOrgIds.length > 0
          ? await supabase
              .from("bookings")
              .select("status, organization_id", { count: "exact" })
              .in("organization_id", activeOrgIds)
          : { data: [], count: 0, error: null as any };

      if (bookingsErr) throw bookingsErr;

      const statusMap = new Map<string, number>();
      for (const b of bookingsData) {
        statusMap.set(b.status, (statusMap.get(b.status) || 0) + 1);
      }

      const totalStaff = (staffRes.data || []).filter((s) => activeOrgSet.has(s.organization_id)).length;

      const totalUsersExcludingSuperAdmin = (profilesRes.data || []).filter((p) => !superAdminIds.has(p.id)).length;

      return {
        totalUsers: totalUsersExcludingSuperAdmin,
        totalOrgs: activeOrgIds.length,
        totalBookings: bookingsCount ?? 0,
        totalStaff,
        statusData: Array.from(statusMap, ([name, value]) => ({ name, value })),
      };
    },
  });

  // Change role mutation
  const changeRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      // Remove existing non-customer roles, then add the new one
      const { error: deleteError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: newRole });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Role updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    },
  });

  // Delete user via edge function
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.functions.invoke("admin-delete-user", {
        body: { user_id: userId },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-platform-stats"] });
      toast({ title: "User deleted" });
      setDeletingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete user", description: err.message, variant: "destructive" });
    },
  });

  const statCards = [
    { title: "Total Users", value: platformStats?.totalUsers ?? users.filter((u) => !u.roles.includes("super_admin")).length, icon: Users },
    { title: "Organizations", value: platformStats?.totalOrgs ?? 0, icon: Building2 },
    { title: "Total Bookings", value: platformStats?.totalBookings ?? 0, icon: CalendarDays },
    { title: "Total Staff", value: platformStats?.totalStaff ?? 0, icon: Shield },
  ];

  const usersExcludingSuperAdmin = users.filter((u) => !u.roles.includes("super_admin"));

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
        {/* <p className="text-muted-foreground">Manage all salon owners and platform activity</p> */}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          {/* Pending signups */}
          {pendingSignups.length > 0 && (
            <Card className="border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-4 w-4" />
                  Pending sign-ups ({pendingSignups.length})
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Approve these users so they can sign in. They will receive a confirmation email.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingSignups.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{p.email}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(p.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            onClick={() => approveUser.mutate(p.id)}
                            disabled={approvingId === p.id}
                          >
                            {approvingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                            Approve
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((card) => (
              <Card key={card.title}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                  <card.icon className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Booking Status Chart */}
          {platformStats?.statusData && platformStats.statusData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Platform-Wide Booking Status</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={{ value: { label: "Bookings" } }} className="h-[220px] w-full">
                  <PieChart>
                    <Pie data={platformStats.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius="70%" label={({ name }) => name}>
                      {platformStats.statusData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* Users Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Users</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersExcludingSuperAdmin.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No users yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    usersExcludingSuperAdmin.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Select
                            defaultValue={u.roles[0] || "salon_owner"}
                            onValueChange={(val) => changeRole.mutate({ userId: u.id, newRole: val as AppRole })}
                          >
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="super_admin">Super Admin</SelectItem>
                              <SelectItem value="salon_owner">Salon Owner</SelectItem>
                              <SelectItem value="staff">Staff</SelectItem>
                              <SelectItem value="customer">Customer</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {u.organization_name ? (
                            <Badge variant="outline">{u.organization_name}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(u.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete {u.full_name || u.email} and all their data. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteUser.mutate(u.id)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="mt-4">
          <SuperAdminAccounts />
        </TabsContent>
      </Tabs>
    </div>
  );
}
