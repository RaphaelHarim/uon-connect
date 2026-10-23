import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BuiltApp } from '../app.js';
import { auditEvents, userRoles, users } from '../db/schema/index.js';
import { createTestApp, login, userId } from './helpers.js';

let built: BuiltApp;
let founderId: string;
beforeAll(async () => {
  built = await createTestApp();
  founderId = await userId(built, 'founder');
});
afterAll(async () => {
  await built.app.close();
});

async function newUser(email: string) {
  const admin = await login(built, 'platformAdmin');
  const r = await admin.post('/admin/users', { email, displayName: 'Pessoa Teste' });
  expect(r.status).toBe(200);
  return r.json().id as string;
}

describe('founder account protection (application layer)', () => {
  it('a platform admin cannot deactivate, demote or edit the founder', async () => {
    const admin = await login(built, 'platformAdmin');
    expect((await admin.post(`/admin/users/${founderId}/status`, { status: 'inactive' })).json().error.code).toBe('founder_protected');
    expect((await admin.del(`/admin/users/${founderId}/roles/supreme_admin`)).status).toBe(403);
    expect((await admin.patch(`/admin/users/${founderId}`, { displayName: 'Outro nome' })).status).toBe(403);
  });

  it('another Supreme Admin cannot deactivate or demote the founder', async () => {
    const other = await login(built, 'supreme');
    const deact = await other.post(`/admin/users/${founderId}/status`, { status: 'offboarded' });
    expect(deact.status).toBe(403);
    expect(deact.json().error.code).toBe('founder_protected');
    const demote = await other.del(`/admin/users/${founderId}/roles/supreme_admin`);
    expect(demote.status).toBe(403);
    expect(demote.json().error.code).toBe('founder_protected');
    const sessions = await other.post(`/admin/users/${founderId}/revoke-sessions`);
    expect(sessions.status).toBe(403);
  });

  it('bulk operations skip the founder and still process the others', async () => {
    const other = await login(built, 'supreme');
    const victim = await newUser('bulk.alvo@demo.uonconnect.local');
    const r = await other.post('/admin/users/bulk-status', { userIds: [founderId, victim], status: 'inactive' });
    expect(r.status).toBe(200);
    const results = r.json().results as { userId: string; ok: boolean; code: string }[];
    expect(results.find((x) => x.userId === founderId)).toMatchObject({ ok: false, code: 'founder_protected' });
    expect(results.find((x) => x.userId === victim)).toMatchObject({ ok: true });
    const [f] = await built.deps.db.select().from(users).where(eq(users.id, founderId));
    expect(f!.status).toBe('active');
  });

  it('the founder cannot be demoted even by the founder through the API', async () => {
    const founder = await login(built, 'founder');
    expect((await founder.del(`/admin/users/${founderId}/roles/supreme_admin`)).status).toBe(403);
    expect((await founder.post(`/admin/users/${founderId}/status`, { status: 'inactive' })).status).toBe(403);
  });

  it('records denied attempts in the audit log', async () => {
    const rows = await built.deps.db.select().from(auditEvents).where(sql`${auditEvents.resourceId} = ${founderId} AND ${auditEvents.outcome} = 'denied'`);
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});

describe('founder account protection (database layer)', () => {
  it('blocks direct deactivation, flag removal, deletion and role removal', async () => {
    const db = built.deps.db;
    await expect(db.update(users).set({ status: 'inactive' }).where(eq(users.id, founderId))).rejects.toThrow();
    await expect(db.update(users).set({ isFounder: false }).where(eq(users.id, founderId))).rejects.toThrow();
    await expect(db.delete(users).where(eq(users.id, founderId))).rejects.toThrow();
    await expect(db.delete(userRoles).where(eq(userRoles.userId, founderId))).rejects.toThrow();
    await expect(db.execute(sql`UPDATE user_identities SET subject = 'hijack' WHERE user_id = ${founderId}`)).rejects.toThrow();
  });

  it('prevents promoting a second founder', async () => {
    const id = await newUser('segundo.fundador@demo.uonconnect.local');
    await expect(built.deps.db.update(users).set({ isFounder: true }).where(eq(users.id, id))).rejects.toThrow();
  });
});

describe('Supreme Admin designation and privilege escalation', () => {
  it('only the founder can designate a Supreme Admin', async () => {
    const target = await newUser('novo.supremo@demo.uonconnect.local');
    const other = await login(built, 'supreme');
    expect((await other.post(`/admin/users/${target}/roles`, { role: 'supreme_admin' })).status).toBe(403);
    const founder = await login(built, 'founder');
    expect((await founder.post(`/admin/users/${target}/roles`, { role: 'supreme_admin' })).status).toBe(200);
    // ...and only the founder can remove it.
    expect((await other.del(`/admin/users/${target}/roles/supreme_admin`)).status).toBe(403);
    expect((await founder.del(`/admin/users/${target}/roles/supreme_admin`)).status).toBe(200);
  });

  it('a regular user cannot change their own permissions or anyone else\'s', async () => {
    const c = await login(built, 'bradesco1');
    expect((await c.post(`/admin/users/${c.userId}/roles`, { role: 'platform_admin' })).status).toBe(403);
    expect((await c.put(`/admin/users/${c.userId}/departments`, { departmentId: c.userId, role: 'head' })).status).toBe(403);
    expect((await c.get('/admin/users')).status).toBe(403);
  });

  it('administrators cannot change their own roles or memberships', async () => {
    const admin = await login(built, 'platformAdmin');
    const structure = (await admin.get('/org/structure')).json();
    const rh = structure.departments.find((d: { name: string }) => d.name === 'RH');
    const r = await admin.put(`/admin/users/${admin.userId}/departments`, { departmentId: rh.id, role: 'head' });
    expect(r.status).toBe(403);
    const sup = await login(built, 'supreme');
    expect((await sup.post(`/admin/users/${sup.userId}/roles`, { role: 'auditor' })).status).toBe(403);
  });

  it('a platform admin cannot grant roles or change privileged accounts', async () => {
    const admin = await login(built, 'platformAdmin');
    const target = await newUser('alvo.papel@demo.uonconnect.local');
    expect((await admin.post(`/admin/users/${target}/roles`, { role: 'platform_admin' })).status).toBe(403);
    const supremeId = await userId(built, 'supreme');
    expect((await admin.post(`/admin/users/${supremeId}/status`, { status: 'inactive' })).status).toBe(403);
  });

  it('deactivation revokes sessions immediately and keeps the history', async () => {
    const target = await newUser('desligado@demo.uonconnect.local');
    await built.deps.db.update(users).set({ isDemo: true }).where(eq(users.id, target));
    const victim = await login(built, 'desligado@demo.uonconnect.local');
    expect((await victim.get('/me')).status).toBe(200);
    const admin = await login(built, 'platformAdmin');
    expect((await admin.post(`/admin/users/${target}/status`, { status: 'offboarded', reason: 'Desligamento (teste)' })).status).toBe(200);
    expect((await victim.get('/me')).status).toBe(401);
    const [row] = await built.deps.db.select().from(users).where(eq(users.id, target));
    expect(row).toMatchObject({ status: 'offboarded' });
  });
});

describe('audit log integrity', () => {
  it('is append-only at the database level', async () => {
    const db = built.deps.db;
    await expect(db.execute(sql`UPDATE audit_events SET action = 'tampered' WHERE id = (SELECT min(id) FROM audit_events)`)).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM audit_events`)).rejects.toThrow();
    await expect(db.execute(sql`TRUNCATE audit_events`)).rejects.toThrow();
  });

  it('has an intact hash chain and only auditors/supreme admins can read it', async () => {
    const auditor = await login(built, 'auditor');
    const v = await auditor.get('/admin/audit/verify');
    expect(v.status).toBe(200);
    expect(v.json()).toMatchObject({ ok: true, broken: 0 });
    const pa = await login(built, 'platformAdmin');
    expect((await pa.get('/admin/audit')).status).toBe(403);
  });
});
