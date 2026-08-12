import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "../lib/auth";
import {
  fetchRecipients,
  triggerTestDigest,
  updateRecipients,
  type DigestRunResult,
} from "../lib/audit";
import { useToast } from "../components/Toast";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export default function AuditLogSettingsPage(): React.ReactElement | null {
  useDocumentTitle("Loglar · Ayarlar");
  const authed = useRequireAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>("");

  const recipientsQuery = useQuery<string[]>({
    queryKey: ["audit-recipients"],
    queryFn: fetchRecipients,
    enabled: authed,
  });

  useEffect(() => {
    if (recipientsQuery.data) {
      setDraft(recipientsQuery.data.join("\n"));
    }
  }, [recipientsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (emails: string[]) => updateRecipients(emails),
    onSuccess: (saved) => {
      toast.push("success", `${saved.length} alıcı kaydedildi`);
      void queryClient.invalidateQueries({ queryKey: ["audit-recipients"] });
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Kaydedilemedi");
    },
  });

  const testMutation = useMutation<DigestRunResult>({
    mutationFn: triggerTestDigest,
    onSuccess: (res) => {
      const d = res.data;
      const detail =
        d.delivered === "smtp"
          ? `SMTP üzerinden ${d.recipients.length} alıcıya gönderildi`
          : d.delivered === "file"
            ? `SMTP yapılandırılmadığı için dosyaya yazıldı: ${d.filePath ?? "/tmp"}`
            : "Gönderim yapılmadı";
      toast.push(
        "success",
        `Digest çalıştırıldı (${d.totalEvents} olay, ${d.actorCount} aktör). ${detail}`,
      );
    },
    onError: (err) => {
      toast.push("error", err instanceof Error ? err.message : "Test başarısız");
    },
  });

  if (!authed) return null;

  const parsed = draft
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            Log E-posta Ayarları
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Günlük (23:00 Europe/Istanbul) audit özetini alacak adresler
          </p>
        </div>
        <Link
          to="/loglar"
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
        >
          ← Loglara dön
        </Link>
      </header>

      <div className="max-w-2xl rounded-xl border border-[var(--color-border)] bg-white p-6">
        <label className="block text-sm font-medium mb-2">
          Alıcı e-postaları (her satıra bir tane)
        </label>
        <textarea
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ad.soyad@toptanbudur.com&#10;ad2.soyad2@toptanbudur.com"
          className="w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-mono"
        />
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {parsed.length} geçerli adres tespit edildi.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveMutation.mutate(parsed)}
            disabled={saveMutation.isPending}
            className="rounded-md bg-[var(--color-brand-navy)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Kaydediliyor…" : "Kaydet"}
          </button>
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="rounded-md border border-[var(--color-border)] bg-white px-4 py-2 text-sm hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
          >
            {testMutation.isPending ? "Gönderiliyor…" : "Test e-posta gönder"}
          </button>
        </div>
      </div>
    </div>
  );
}
