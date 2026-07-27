'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Save, Bell, Shield, Globe } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Settings</h2>
          <p className="text-muted-foreground">Configure your church and ministry settings</p>
        </div>
        <Button>
          <Save className="h-4 w-4 mr-1" />
          Save Changes
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card className="card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Church Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="church-name">Church Name</Label>
                  <Input id="church-name" defaultValue="JOHIA Bankers" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="church-email">Email</Label>
                  <Input id="church-email" type="email" defaultValue="info@johiabankers.com" className="mt-1.5" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="church-phone">Phone</Label>
                  <Input id="church-phone" type="tel" placeholder="+1 (555) 123-4567" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="church-address">Address</Label>
                  <Input id="church-address" placeholder="123 Faith Street" className="mt-1.5" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Scheduling Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="max-assignments">Default Max Monthly Assignments</Label>
                  <Input id="max-assignments" type="number" defaultValue="3" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="min-backup">Minimum Backup Singers</Label>
                  <Input id="min-backup" type="number" defaultValue="3" className="mt-1.5" />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="max-backup">Maximum Backup Singers</Label>
                  <Input id="max-backup" type="number" defaultValue="5" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="cooldown">Cooldown Weeks</Label>
                  <Input id="cooldown" type="number" defaultValue="1" className="mt-1.5" />
                </div>
              </div>
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                  <span className="text-sm text-foreground">Enable fairness balancing</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                  <span className="text-sm text-foreground">Enable cooldown rule</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                  <span className="text-sm text-foreground">Enable leader rotation</span>
                </label>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                Notifications
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                <span className="text-sm text-foreground">Assignment notifications</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                <span className="text-sm text-foreground">Conflict alerts</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked className="rounded border-border bg-transparent" />
                <span className="text-sm text-foreground">Schedule published</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-border bg-transparent" />
                <span className="text-sm text-foreground">Weekly reminders</span>
              </label>
            </CardContent>
          </Card>

          <Card className="card-glow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start">
                Change Password
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Two-Factor Authentication
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Manage API Keys
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
