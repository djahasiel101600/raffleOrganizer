import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TicketPlus } from "lucide-react";

import {
  fetchSettings,
  initializeTickets,
  updateSettings,
} from "@/services/settings";
import { ApiClientError } from "@/services/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { RaffleSettings as RaffleSettingsType } from "@/types";

export default function Settings() {
  const [settings, setSettings] = useState<RaffleSettingsType | null>(null);
  const [form, setForm] = useState({
    raffle_name: "",
    start: 1,
    end: 1000,
    padding: 4,
    tickets_per_column: 3,
  });
  const [saving, setSaving] = useState(false);
  const [confirmInit, setConfirmInit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSettings();
      setSettings(data);
      setForm({
        raffle_name: data.raffle_name,
        start: data.starting_ticket_number,
        end: data.ending_ticket_number,
        padding: data.ticket_number_padding,
        tickets_per_column: data.default_tickets_per_column,
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to load settings."
          : "Unable to connect to the server."
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const rangeChanged =
      form.start !== (settings?.starting_ticket_number ?? -1) ||
      form.end !== (settings?.ending_ticket_number ?? -1);

    if (rangeChanged) {
      setConfirmInit(true);
      return;
    }

    setSaving(true);
    try {
      await updateSettings({
        raffle_name: form.raffle_name.trim() || "Annual Community Raffle",
        ticket_number_padding: form.padding,
        default_tickets_per_column: form.tickets_per_column,
      });
      toast.success("Settings saved.");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to save settings."
          : "Unable to connect to the server."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleInitialize = async () => {
    setSaving(true);
    try {
      await initializeTickets({
        start: form.start,
        end: form.end,
        padding: form.padding,
        force: Boolean(settings?.tickets_exist),
      });
      setConfirmInit(false);
      toast.success(
        `Ticket range ${form.start} – ${form.end} created (${form.end - form.start + 1} tickets).`
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.detail ?? "Unable to initialize tickets."
          : "Unable to connect to the server."
      );
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <Card className="mx-auto mt-16 max-w-md">
        <CardContent className="space-y-4 p-6 text-center">
          <h2 className="text-lg font-semibold">Settings unavailable</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={() => void load()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Card>
          <CardContent className="space-y-4 p-6">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-6 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Raffle configuration and ticket range
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raffle Settings</CardTitle>
          <CardDescription>
            {settings.tickets_exist
              ? `${settings.ticket_count} tickets currently exist. Changing the ticket range requires confirmation.`
              : "No tickets exist yet — a ticket range will be created on save."}
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-lg space-y-4">
          <div className="space-y-2">
            <Label htmlFor="raffle_name">Raffle Name</Label>
            <Input
              id="raffle_name"
              value={form.raffle_name}
              onChange={(e) => setForm({ ...form, raffle_name: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start">Starting Number</Label>
              <Input
                id="start"
                type="number"
                min={1}
                value={form.start}
                onChange={(e) =>
                  setForm({ ...form, start: parseInt(e.target.value, 10) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end">Ending Number</Label>
              <Input
                id="end"
                type="number"
                min={1}
                value={form.end}
                onChange={(e) =>
                  setForm({ ...form, end: parseInt(e.target.value, 10) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="padding">Number Padding</Label>
              <Input
                id="padding"
                type="number"
                min={0}
                max={12}
                value={form.padding}
                onChange={(e) =>
                  setForm({ ...form, padding: parseInt(e.target.value, 10) || 0 })
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Padding example: 25 with padding 4 displays as 0025.
          </p>
<div className="space-y-2">
            <Label htmlFor="per_column">Default Tickets Per Column</Label>
            <Select
              value={String(form.tickets_per_column)}
              onValueChange={(value) =>
                setForm({ ...form, tickets_per_column: Number(value) })
              }
            >
              <SelectTrigger id="per_column" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {settings.tickets_exist && (
              <Button
                variant="outline"
                onClick={() => setConfirmInit(true)}
                disabled={saving}
              >
                <TicketPlus className="h-4 w-4" />
                Apply range
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmInit}
        onOpenChange={(open) => {
          if (!open) setConfirmInit(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {settings.tickets_exist
                ? "Re-initialize the ticket range?"
                : "Create the ticket range?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {settings.tickets_exist ? (
                <>
                  Tickets already exist. Applying the range{" "}
                  <strong>
                    {form.start} – {form.end}
                  </strong>{" "}
                  will delete the current {settings.ticket_count} tickets and all
                  existing reservations. This cannot be undone.
                </>
              ) : (
                <>
                  This will create {form.end - form.start + 1} tickets from{" "}
                  {form.start} to {form.end}, all marked Available.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleInitialize} disabled={saving}>
              {saving
                ? "Working…"
                : settings.tickets_exist
                  ? "Yes, delete and re-initialize"
                  : "Create tickets"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}