import { useCallback, useEffect, useState } from 'react';
import type { AdminClient } from '../api/client';
import { ApiError, type Coordinator, type FirmSummary } from '../api/types';

/**
 * UX-FRM-007 firm coordinator team administration. Ordinary account admin — NOT
 * maker-checker. The rules the UI surfaces (all enforced server-side):
 *  - a sole coordinator is the lead; handover is immediate and can only be
 *    reversed by the new lead (never the outgoing one);
 *  - the outgoing lead keeps ordinary coordinator access;
 *  - a PIN change needs the current PIN;
 *  - removing a coordinator is immediate; a re-add issues a NEW access code.
 */
export function FirmTeamPage({ client }: { client: AdminClient }): JSX.Element {
  const [firms, setFirms] = useState<FirmSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: '' });

  useEffect(() => {
    void (async () => {
      try {
        const fs = await client.listFirms();
        setFirms(fs);
        if (fs[0]) setOrgId(fs[0].id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load firms');
      }
    })();
  }, [client]);

  const reload = useCallback(
    async (id: string) => {
      setError(null);
      try {
        setCoordinators(await client.listCoordinators(id));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load coordinators');
      }
    },
    [client],
  );

  useEffect(() => {
    if (orgId) void reload(orgId);
  }, [orgId, reload]);

  const lead = coordinators.find((c) => c.isLead) ?? null;

  async function guarded(fn: () => Promise<void>): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (orgId) await reload(orgId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action could not be completed');
    }
  }

  async function addOne(asLead: boolean): Promise<void> {
    if (!orgId || !form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      ...(form.role.trim() ? { role: form.role.trim() } : {}),
    };
    await guarded(async () => {
      const created = asLead
        ? await client.createLeadCoordinator(orgId, body)
        : await client.addCoordinator(orgId, body);
      setForm({ name: '', email: '', role: '' });
      setNotice(`Added ${created.name}. Access code: ${created.accessCode}`);
    });
  }

  async function handover(newLeadId: string): Promise<void> {
    if (!orgId || !lead) return;
    await guarded(() =>
      client
        .handoverLead(orgId, { actingCoordinatorId: lead.id, newLeadCoordinatorId: newLeadId })
        .then(() => setNotice('Lead handed over. This cannot be reversed by the outgoing lead.')),
    );
  }

  async function changePin(c: Coordinator): Promise<void> {
    if (!orgId) return;
    const newPin = window.prompt(`New PIN for ${c.name} (min 4 digits)`);
    if (!newPin) return;
    const currentPin = window.prompt('Current PIN (leave blank if none set yet)') ?? '';
    await guarded(() =>
      client
        .setCoordinatorPin(orgId, c.id, currentPin ? { newPin, currentPin } : { newPin })
        .then(() => setNotice(`PIN updated for ${c.name}.`)),
    );
  }

  async function remove(c: Coordinator): Promise<void> {
    if (!orgId) return;
    await guarded(() =>
      client.removeCoordinator(orgId, c.id).then(() => setNotice(`Removed ${c.name}.`)),
    );
  }

  return (
    <main>
      <p className="eyebrow">Firm account</p>
      <h1 tabIndex={-1}>Coordinator team</h1>
      <p className="lede">
        Manage a firm’s coordinators. This is ordinary account administration — it does not go
        through maker-checker.
      </p>

      <label className="field">
        Firm
        <select value={orgId ?? ''} onChange={(e) => setOrgId(e.target.value || null)}>
          {firms.length === 0 && <option value="">No firms</option>}
          {firms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.displayName}
            </option>
          ))}
        </select>
      </label>

      {error && <div className="err">{error}</div>}
      {notice && <p className="qstate ok">{notice}</p>}

      <table className="ftbl">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Lead</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {coordinators.length === 0 ? (
            <tr>
              <td colSpan={5}>
                No coordinators yet. The first one you add becomes the lead (sole coordinator).
              </td>
            </tr>
          ) : (
            coordinators.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.email}</td>
                <td>{c.role ?? '—'}</td>
                <td>{c.isLead ? 'Lead' : ''}</td>
                <td className="actions">
                  <button type="button" className="btn-2" onClick={() => void changePin(c)}>
                    PIN
                  </button>
                  {!c.isLead && (
                    <button type="button" className="btn-2" onClick={() => void handover(c.id)}>
                      Make lead
                    </button>
                  )}
                  {!c.isLead && (
                    <button type="button" className="btn-2" onClick={() => void remove(c)}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <fieldset className="contact-fields">
        <legend>Add a coordinator</legend>
        <label className="field">
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field">
          Email
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label className="field">
          Role (optional)
          <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </label>
        <div className="actions">
          {!lead ? (
            <button type="button" className="btn" onClick={() => void addOne(true)}>
              Add as lead
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void addOne(false)}>
              Add coordinator
            </button>
          )}
        </div>
        {!lead && (
          <p className="lede" style={{ fontSize: 13 }}>
            This firm has no lead yet — the first coordinator you add becomes the lead.
          </p>
        )}
      </fieldset>
    </main>
  );
}
